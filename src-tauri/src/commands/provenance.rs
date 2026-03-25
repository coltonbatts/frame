use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::files::{extract_thumbnail, probe_media};
use crate::commands::scenes::detect_scenes;
use crate::models::{
    AnalyzeProvenanceRequest, DeleteProvenanceShotRequest, ProvenanceState, ShotRecord,
    UpdateProvenanceShotRequest,
};

const PROVENANCE_VERSION: u8 = 1;
const OUTPUT_SUFFIX: &str = "_provenance";
const SIDECAR_FILE_NAME: &str = "provenance.json";
const CSV_FILE_NAME: &str = "provenance.csv";
const THUMBNAIL_DIR_NAME: &str = "thumbnails";
const DEFAULT_SOURCE_TYPE: &str = "Unknown";
const DEFAULT_REVIEW_STATUS: &str = "unreviewed";
const MIN_SHOT_SECONDS: f64 = 0.25;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProvenanceSidecar {
    version: u8,
    video_path: String,
    video_name: String,
    video_duration_sec: f64,
    analyzed_at: String,
    scene_threshold: f64,
    output_dir: String,
    thumbnail_dir: String,
    shots: Vec<ShotRecord>,
    warnings: Vec<String>,
}

#[tauri::command]
pub async fn load_provenance(video_path: String) -> Result<Option<ProvenanceState>, String> {
    let video_path = resolve_video_path(&video_path)?;
    let sidecar_path = sidecar_path_for_video(&video_path)?;

    if !sidecar_path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(&sidecar_path)
        .map_err(|error| format!("failed to read provenance sidecar: {}", error))?;
    let sidecar = serde_json::from_slice::<ProvenanceSidecar>(&bytes)
        .map_err(|error| format!("failed to parse provenance sidecar: {}", error))?;

    let probe = probe_media(video_path.to_string_lossy().as_ref())?;
    let mut state = to_state(video_path.as_path(), sidecar);
    let mut changed = false;

    if (state.video_duration_sec - probe.duration).abs() > 0.01 {
        state.video_duration_sec = probe.duration;
        changed = true;
    }

    normalize_state(&mut state, probe.fps);

    if hydrate_missing_thumbnails(video_path.as_path(), &mut state).await? {
        changed = true;
    }

    if changed {
        persist_state(&state)?;
    }

    Ok(Some(state))
}

#[tauri::command]
pub async fn analyze_provenance(
    request: AnalyzeProvenanceRequest,
) -> Result<ProvenanceState, String> {
    let video_path = resolve_video_path(&request.path)?;
    let probe = probe_media(video_path.to_string_lossy().as_ref())?;

    if !probe.has_video {
        return Err("provenance analysis requires a video track".to_string());
    }

    let output_dir = output_dir_for_video(&video_path)?;
    clear_directory(&output_dir)?;
    let thumbnail_dir = output_dir.join(THUMBNAIL_DIR_NAME);
    fs::create_dir_all(&thumbnail_dir)
        .map_err(|error| format!("failed to create provenance output directory: {}", error))?;

    let scene_threshold = scene_threshold(request.sensitivity);
    let mut warnings = Vec::new();
    let scenes = match detect_scenes(
        video_path.to_string_lossy().into_owned(),
        request.sensitivity,
    )
    .await
    {
        Ok(scenes) if !scenes.is_empty() => scenes,
        Ok(_) => {
            warnings.push(
                "Scene detection returned no boundaries; using one shot for the full clip."
                    .to_string(),
            );
            vec![fallback_scene(probe.duration)]
        }
        Err(error) => {
            warnings.push(format!(
                "Scene detection fallback: {}",
                summarize_error(&error)
            ));
            vec![fallback_scene(probe.duration)]
        }
    };

    let video_name = file_name(&video_path);
    let mut shots = Vec::with_capacity(scenes.len());

    for (index, scene) in scenes.into_iter().enumerate() {
        let shot_id = format!("shot-{:03}", index + 1);
        let start_time_sec = scene.start_time.max(0.0);
        let end_time_sec = normalize_end_time(start_time_sec, scene.end_time, probe.duration);
        let thumbnail_frame_sec = midpoint(start_time_sec, end_time_sec);
        let thumbnail_path = write_thumbnail(
            video_path.as_path(),
            &thumbnail_dir,
            &shot_id,
            thumbnail_frame_sec,
            scene.thumbnail_path.as_deref(),
        )
        .await?;

        shots.push(build_shot_record(
            &shot_id,
            &video_name,
            start_time_sec,
            end_time_sec,
            thumbnail_frame_sec,
            thumbnail_path,
            scene.confidence,
            probe.fps,
        ));
    }

    let mut state = ProvenanceState {
        video_path: video_path.to_string_lossy().into_owned(),
        video_name: video_name.clone(),
        video_duration_sec: probe.duration,
        analyzed_at: iso_timestamp(),
        scene_threshold,
        output_dir: output_dir.to_string_lossy().into_owned(),
        thumbnail_dir: thumbnail_dir.to_string_lossy().into_owned(),
        sidecar_path: sidecar_path_for_output(&output_dir)
            .to_string_lossy()
            .into_owned(),
        csv_path: csv_path_for_output(&output_dir)
            .to_string_lossy()
            .into_owned(),
        shots,
        warnings,
    };

    normalize_state(&mut state, probe.fps);
    persist_state(&state)?;
    Ok(state)
}

#[tauri::command]
pub async fn update_provenance_shot(
    request: UpdateProvenanceShotRequest,
) -> Result<ProvenanceState, String> {
    let video_path = resolve_video_path(&request.video_path)?;
    let probe = probe_media(video_path.to_string_lossy().as_ref())?;
    let mut state = load_state(&video_path)?;
    let index = state
        .shots
        .iter()
        .position(|shot| shot.id == request.shot.id)
        .ok_or_else(|| format!("shot {} was not found", request.shot.id))?;

    let updated = normalize_incoming_shot(
        request.shot,
        &state.video_name,
        probe.fps,
        state.video_duration_sec,
        &state.thumbnail_dir,
    );

    let original = state.shots[index].clone();
    state.shots[index] = updated;

    align_neighbors(
        &mut state.shots,
        index,
        probe.fps,
        state.video_duration_sec,
        video_path.as_path(),
        &state.thumbnail_dir,
    )
    .await?;
    refresh_modified_shot(
        video_path.as_path(),
        &PathBuf::from(&state.thumbnail_dir),
        probe.fps,
        state.video_duration_sec,
        &state.shots[index],
    )
    .await?;

    if has_meaningful_difference(&original, &state.shots[index])
        && state.shots[index].review_status.as_deref() != Some("reviewed")
    {
        state.shots[index].review_status = Some("adjusted".to_string());
    }

    normalize_state(&mut state, probe.fps);
    persist_state(&state)?;
    Ok(state)
}

#[tauri::command]
pub async fn delete_provenance_shot(
    request: DeleteProvenanceShotRequest,
) -> Result<ProvenanceState, String> {
    let video_path = resolve_video_path(&request.video_path)?;
    let probe = probe_media(video_path.to_string_lossy().as_ref())?;
    let mut state = load_state(&video_path)?;
    let index = state
        .shots
        .iter()
        .position(|shot| shot.id == request.shot_id)
        .ok_or_else(|| format!("shot {} was not found", request.shot_id))?;

    let removed = state.shots.remove(index);
    remove_thumbnail(&removed.thumbnail_path);

    if state.shots.is_empty() {
        persist_state(&state)?;
        return Ok(state);
    }

    if index == 0 {
        if let Some(next) = state.shots.get_mut(0) {
            next.start_time_sec = 0.0;
            next.review_status = Some("adjusted".to_string());
        }
    } else {
        let previous_index = index - 1;
        let bridge_time = state
            .shots
            .get(index)
            .map(|shot| shot.start_time_sec)
            .unwrap_or(removed.end_time_sec);

        if let Some(previous) = state.shots.get_mut(previous_index) {
            previous.end_time_sec = bridge_time.max(previous.start_time_sec + MIN_SHOT_SECONDS);
            previous.review_status = Some("adjusted".to_string());
        }
    }

    normalize_state(&mut state, probe.fps);
    refresh_all_thumbnails(
        video_path.as_path(),
        &state.thumbnail_dir,
        probe.fps,
        state.video_duration_sec,
        &mut state.shots,
    )
    .await?;
    persist_state(&state)?;
    Ok(state)
}

async fn hydrate_missing_thumbnails(
    video_path: &Path,
    state: &mut ProvenanceState,
) -> Result<bool, String> {
    let probe = probe_media(video_path.to_string_lossy().as_ref())?;
    let mut changed = false;
    let thumbnail_dir = PathBuf::from(&state.thumbnail_dir);

    for shot in &mut state.shots {
        let thumbnail_path = shot
            .thumbnail_path
            .as_ref()
            .map(PathBuf::from)
            .filter(|path| path.exists());

        if thumbnail_path.is_none() {
            let refreshed = refresh_modified_shot(
                video_path,
                &thumbnail_dir,
                probe.fps,
                state.video_duration_sec,
                shot,
            )
            .await?;
            *shot = refreshed;
            changed = true;
        }
    }

    Ok(changed)
}

async fn refresh_all_thumbnails(
    video_path: &Path,
    thumbnail_dir: &str,
    fps: f64,
    video_duration_sec: f64,
    shots: &mut [ShotRecord],
) -> Result<(), String> {
    let thumbnail_dir = PathBuf::from(thumbnail_dir);

    for shot in shots {
        let refreshed =
            refresh_modified_shot(video_path, &thumbnail_dir, fps, video_duration_sec, shot)
                .await?;
        *shot = refreshed;
    }

    Ok(())
}

async fn align_neighbors(
    shots: &mut [ShotRecord],
    index: usize,
    fps: f64,
    video_duration_sec: f64,
    video_path: &Path,
    thumbnail_dir: &str,
) -> Result<(), String> {
    if shots.is_empty() || index >= shots.len() {
        return Ok(());
    }

    if index > 0 {
        let previous_index = index - 1;
        let start_time = shots[index].start_time_sec;
        if let Some(previous) = shots.get_mut(previous_index) {
            if (previous.end_time_sec - start_time).abs() > 0.01 {
                previous.end_time_sec = start_time.max(previous.start_time_sec + MIN_SHOT_SECONDS);
                previous.review_status = Some("adjusted".to_string());
            }
        }
    }

    if index + 1 < shots.len() {
        let end_time = shots[index].end_time_sec;
        if let Some(next) = shots.get_mut(index + 1) {
            if (next.start_time_sec - end_time).abs() > 0.01 {
                next.start_time_sec = end_time.max(0.0);
                next.review_status = Some("adjusted".to_string());
            }
        }
    }

    if index > 0 {
        let previous_index = index - 1;
        let refreshed = refresh_modified_shot(
            video_path,
            &PathBuf::from(thumbnail_dir),
            fps,
            video_duration_sec,
            &shots[previous_index],
        )
        .await?;
        shots[previous_index] = refreshed;
    }

    if index + 1 < shots.len() {
        let refreshed = refresh_modified_shot(
            video_path,
            &PathBuf::from(thumbnail_dir),
            fps,
            video_duration_sec,
            &shots[index + 1],
        )
        .await?;
        shots[index + 1] = refreshed;
    }

    Ok(())
}

async fn refresh_modified_shot(
    video_path: &Path,
    thumbnail_dir: &Path,
    fps: f64,
    video_duration_sec: f64,
    shot: &ShotRecord,
) -> Result<ShotRecord, String> {
    let start_time_sec = shot.start_time_sec.max(0.0);
    let end_time_sec = normalize_end_time(start_time_sec, shot.end_time_sec, video_duration_sec);
    let thumbnail_frame_sec = midpoint(start_time_sec, end_time_sec);
    let thumbnail_path = write_thumbnail(
        video_path,
        thumbnail_dir,
        &shot.id,
        thumbnail_frame_sec,
        None,
    )
    .await?;

    Ok(ShotRecord {
        id: shot.id.clone(),
        video_name: shot.video_name.clone(),
        start_time_sec,
        end_time_sec,
        start_timecode: Some(format_timecode(start_time_sec, fps)),
        end_timecode: Some(format_timecode(end_time_sec, fps)),
        thumbnail_path: Some(thumbnail_path),
        thumbnail_frame_sec: Some(thumbnail_frame_sec),
        description: shot.description.clone(),
        source_type: shot
            .source_type
            .clone()
            .or_else(|| Some(DEFAULT_SOURCE_TYPE.to_string())),
        source_name: shot.source_name.clone(),
        source_reference: shot.source_reference.clone(),
        notes: shot.notes.clone(),
        detection_confidence: shot.detection_confidence,
        review_status: shot
            .review_status
            .clone()
            .or_else(|| Some(DEFAULT_REVIEW_STATUS.to_string())),
    })
}

fn normalize_incoming_shot(
    shot: ShotRecord,
    video_name: &str,
    fps: f64,
    video_duration_sec: f64,
    thumbnail_dir: &str,
) -> ShotRecord {
    let shot_id = shot.id.clone();
    let start_time_sec = shot.start_time_sec.max(0.0);
    let end_time_sec = normalize_end_time(start_time_sec, shot.end_time_sec, video_duration_sec);
    let thumbnail_frame_sec = shot
        .thumbnail_frame_sec
        .filter(|value| value.is_finite() && *value >= 0.0)
        .unwrap_or_else(|| midpoint(start_time_sec, end_time_sec));

    ShotRecord {
        id: shot.id,
        video_name: video_name.to_string(),
        start_time_sec,
        end_time_sec,
        start_timecode: Some(format_timecode(start_time_sec, fps)),
        end_timecode: Some(format_timecode(end_time_sec, fps)),
        thumbnail_path: Some(
            PathBuf::from(thumbnail_dir)
                .join(format!("{}.jpg", shot_id.trim()))
                .to_string_lossy()
                .into_owned(),
        ),
        thumbnail_frame_sec: Some(thumbnail_frame_sec),
        description: blank_to_none(shot.description),
        source_type: shot
            .source_type
            .or_else(|| Some(DEFAULT_SOURCE_TYPE.to_string())),
        source_name: blank_to_none(shot.source_name),
        source_reference: blank_to_none(shot.source_reference),
        notes: blank_to_none(shot.notes),
        detection_confidence: shot.detection_confidence,
        review_status: shot
            .review_status
            .or_else(|| Some(DEFAULT_REVIEW_STATUS.to_string())),
    }
}

fn build_shot_record(
    id: &str,
    video_name: &str,
    start_time_sec: f64,
    end_time_sec: f64,
    thumbnail_frame_sec: f64,
    thumbnail_path: String,
    detection_confidence: f64,
    fps: f64,
) -> ShotRecord {
    ShotRecord {
        id: id.to_string(),
        video_name: video_name.to_string(),
        start_time_sec,
        end_time_sec,
        start_timecode: Some(format_timecode(start_time_sec, fps)),
        end_timecode: Some(format_timecode(end_time_sec, fps)),
        thumbnail_path: Some(thumbnail_path),
        thumbnail_frame_sec: Some(thumbnail_frame_sec),
        description: None,
        source_type: Some(DEFAULT_SOURCE_TYPE.to_string()),
        source_name: None,
        source_reference: None,
        notes: None,
        detection_confidence,
        review_status: Some(DEFAULT_REVIEW_STATUS.to_string()),
    }
}

async fn write_thumbnail(
    video_path: &Path,
    thumbnail_dir: &Path,
    shot_id: &str,
    frame_sec: f64,
    source_thumbnail_path: Option<&str>,
) -> Result<String, String> {
    fs::create_dir_all(thumbnail_dir)
        .map_err(|error| format!("failed to create thumbnail directory: {}", error))?;

    let thumbnail_path = thumbnail_dir.join(format!("{}.jpg", shot_id));
    if thumbnail_path.exists() {
        fs::remove_file(&thumbnail_path)
            .map_err(|error| format!("failed to replace thumbnail {}: {}", shot_id, error))?;
    }

    if let Some(source_path) = source_thumbnail_path {
        let source = PathBuf::from(source_path);
        if source.exists() {
            fs::copy(&source, &thumbnail_path).map_err(|error| {
                format!(
                    "failed to copy thumbnail for {} into provenance output: {}",
                    shot_id, error
                )
            })?;

            let _ = fs::remove_file(source);
            return Ok(thumbnail_path.to_string_lossy().into_owned());
        }
    }

    let temp_thumbnail = extract_thumbnail(video_path.to_string_lossy().into_owned(), frame_sec)
        .await
        .map_err(|error| summarize_error(&error))?;
    let source = PathBuf::from(temp_thumbnail.path);

    fs::copy(&source, &thumbnail_path).map_err(|error| {
        format!(
            "failed to write provenance thumbnail for {}: {}",
            shot_id, error
        )
    })?;
    let _ = fs::remove_file(source);

    Ok(thumbnail_path.to_string_lossy().into_owned())
}

fn to_state(video_path: &Path, sidecar: ProvenanceSidecar) -> ProvenanceState {
    let output_dir = PathBuf::from(&sidecar.output_dir);
    ProvenanceState {
        video_path: video_path.to_string_lossy().into_owned(),
        video_name: sidecar.video_name,
        video_duration_sec: sidecar.video_duration_sec,
        analyzed_at: sidecar.analyzed_at,
        scene_threshold: sidecar.scene_threshold,
        output_dir: output_dir.to_string_lossy().into_owned(),
        thumbnail_dir: PathBuf::from(&sidecar.thumbnail_dir)
            .to_string_lossy()
            .into_owned(),
        sidecar_path: sidecar_path_for_output(&output_dir)
            .to_string_lossy()
            .into_owned(),
        csv_path: csv_path_for_output(&output_dir)
            .to_string_lossy()
            .into_owned(),
        shots: sidecar.shots,
        warnings: sidecar.warnings,
    }
}

fn load_state(video_path: &Path) -> Result<ProvenanceState, String> {
    let sidecar_path = sidecar_path_for_video(video_path)?;
    let bytes = fs::read(&sidecar_path)
        .map_err(|error| format!("failed to read provenance sidecar: {}", error))?;
    let sidecar = serde_json::from_slice::<ProvenanceSidecar>(&bytes)
        .map_err(|error| format!("failed to parse provenance sidecar: {}", error))?;
    Ok(to_state(video_path, sidecar))
}

fn persist_state(state: &ProvenanceState) -> Result<(), String> {
    let output_dir = PathBuf::from(&state.output_dir);
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("failed to create provenance output directory: {}", error))?;
    fs::create_dir_all(&state.thumbnail_dir)
        .map_err(|error| format!("failed to create thumbnail directory: {}", error))?;

    let mut shots = state.shots.clone();
    shots.sort_by(|left, right| {
        left.start_time_sec
            .partial_cmp(&right.start_time_sec)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.id.cmp(&right.id))
    });

    let sidecar = ProvenanceSidecar {
        version: PROVENANCE_VERSION,
        video_path: state.video_path.clone(),
        video_name: state.video_name.clone(),
        video_duration_sec: state.video_duration_sec,
        analyzed_at: state.analyzed_at.clone(),
        scene_threshold: state.scene_threshold,
        output_dir: state.output_dir.clone(),
        thumbnail_dir: state.thumbnail_dir.clone(),
        shots: shots.clone(),
        warnings: state.warnings.clone(),
    };

    let sidecar_bytes = serde_json::to_vec_pretty(&sidecar)
        .map_err(|error| format!("failed to serialize provenance sidecar: {}", error))?;
    fs::write(&state.sidecar_path, sidecar_bytes)
        .map_err(|error| format!("failed to write provenance sidecar: {}", error))?;

    fs::write(&state.csv_path, build_csv(&shots))
        .map_err(|error| format!("failed to write provenance csv: {}", error))?;

    Ok(())
}

fn build_csv(shots: &[ShotRecord]) -> String {
    let mut csv = String::from(
        "id,videoName,startTimeSec,endTimeSec,startTimecode,endTimecode,thumbnailPath,thumbnailFrameSec,description,sourceType,sourceName,sourceReference,notes,detectionConfidence,reviewStatus\n",
    );

    for shot in shots {
        let line = [
            csv_escape(&shot.id),
            csv_escape(&shot.video_name),
            format_decimal(shot.start_time_sec),
            format_decimal(shot.end_time_sec),
            csv_escape(shot.start_timecode.as_deref().unwrap_or_default()),
            csv_escape(shot.end_timecode.as_deref().unwrap_or_default()),
            csv_escape(shot.thumbnail_path.as_deref().unwrap_or_default()),
            shot.thumbnail_frame_sec
                .map(format_decimal)
                .unwrap_or_default(),
            csv_escape(shot.description.as_deref().unwrap_or_default()),
            csv_escape(shot.source_type.as_deref().unwrap_or_default()),
            csv_escape(shot.source_name.as_deref().unwrap_or_default()),
            csv_escape(shot.source_reference.as_deref().unwrap_or_default()),
            csv_escape(shot.notes.as_deref().unwrap_or_default()),
            format_decimal(shot.detection_confidence),
            csv_escape(shot.review_status.as_deref().unwrap_or_default()),
        ]
        .join(",");
        csv.push_str(&line);
        csv.push('\n');
    }

    csv
}

fn normalize_state(state: &mut ProvenanceState, fps: f64) {
    state.shots.sort_by(|left, right| {
        left.start_time_sec
            .partial_cmp(&right.start_time_sec)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.id.cmp(&right.id))
    });

    for shot in &mut state.shots {
        shot.video_name = state.video_name.clone();
        shot.start_time_sec = shot.start_time_sec.max(0.0);
        shot.end_time_sec = normalize_end_time(
            shot.start_time_sec,
            shot.end_time_sec,
            state.video_duration_sec,
        );
        shot.start_timecode = Some(format_timecode(shot.start_time_sec, fps));
        shot.end_timecode = Some(format_timecode(shot.end_time_sec, fps));
        shot.thumbnail_frame_sec = Some(midpoint(shot.start_time_sec, shot.end_time_sec));
        if shot.source_type.is_none() {
            shot.source_type = Some(DEFAULT_SOURCE_TYPE.to_string());
        }
        if shot.review_status.is_none() {
            shot.review_status = Some(DEFAULT_REVIEW_STATUS.to_string());
        }
    }
}

fn midpoint(start_time_sec: f64, end_time_sec: f64) -> f64 {
    let duration = (end_time_sec - start_time_sec).max(MIN_SHOT_SECONDS);
    start_time_sec + (duration / 2.0)
}

fn normalize_end_time(start_time_sec: f64, end_time_sec: f64, video_duration_sec: f64) -> f64 {
    let lower_bound = start_time_sec + MIN_SHOT_SECONDS;
    let candidate = if video_duration_sec > 0.0 {
        end_time_sec.min(video_duration_sec)
    } else {
        end_time_sec
    };

    candidate.max(lower_bound)
}

fn build_single_scene(duration_sec: f64) -> crate::models::Scene {
    crate::models::Scene {
        index: 1,
        start_time: 0.0,
        end_time: duration_sec.max(1.0),
        confidence: 58.0,
        thumbnail_color: "#334155".to_string(),
        thumbnail_path: None,
    }
}

fn fallback_scene(duration_sec: f64) -> crate::models::Scene {
    build_single_scene(duration_sec)
}

fn csv_escape(value: &str) -> String {
    let needs_quotes = value.contains(',') || value.contains('"') || value.contains('\n');
    if needs_quotes {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn format_decimal(value: f64) -> String {
    let formatted = format!("{:.3}", value.max(0.0));
    formatted
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string()
}

fn format_timecode(total_seconds: f64, fps: f64) -> String {
    let safe_seconds = total_seconds.max(0.0);
    let safe_fps = if fps.is_finite() && fps > 0.0 {
        fps
    } else {
        24.0
    };
    let whole_seconds = safe_seconds.floor();
    let hours = (whole_seconds / 3600.0).floor() as u64;
    let minutes = ((whole_seconds % 3600.0) / 60.0).floor() as u64;
    let seconds = (whole_seconds % 60.0).floor() as u64;
    let frames = ((safe_seconds - whole_seconds) * safe_fps).floor() as u64;

    format!("{:02}:{:02}:{:02}:{:02}", hours, minutes, seconds, frames)
}

fn scene_threshold(sensitivity: f64) -> f64 {
    let normalized = sensitivity.clamp(1.0, 100.0) / 100.0;
    (0.62 - (normalized * 0.47)).clamp(0.12, 0.62)
}

fn resolve_video_path(video_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(video_path);
    if !path.exists() {
        return Err(format!("video path was not found: {}", video_path));
    }

    if !path.is_file() {
        return Err(format!("video path is not a file: {}", video_path));
    }

    Ok(path)
}

fn output_dir_for_video(video_path: &Path) -> Result<PathBuf, String> {
    let parent = video_path
        .parent()
        .ok_or_else(|| "the selected video must live on disk".to_string())?;
    Ok(parent.join(format!("{}{}", video_stem(video_path)?, OUTPUT_SUFFIX)))
}

fn sidecar_path_for_video(video_path: &Path) -> Result<PathBuf, String> {
    Ok(output_dir_for_video(video_path)?.join(SIDECAR_FILE_NAME))
}

fn sidecar_path_for_output(output_dir: &Path) -> PathBuf {
    output_dir.join(SIDECAR_FILE_NAME)
}

fn csv_path_for_output(output_dir: &Path) -> PathBuf {
    output_dir.join(CSV_FILE_NAME)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn video_stem(video_path: &Path) -> Result<String, String> {
    video_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "the selected video must have a file name".to_string())
}

fn clear_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(path)
        .map_err(|error| format!("failed to read provenance output directory: {}", error))?
    {
        let entry =
            entry.map_err(|error| format!("failed to read provenance output entry: {}", error))?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            fs::remove_dir_all(&entry_path)
                .map_err(|error| format!("failed to remove old provenance directory: {}", error))?;
        } else {
            fs::remove_file(&entry_path)
                .map_err(|error| format!("failed to remove old provenance file: {}", error))?;
        }
    }

    Ok(())
}

fn summarize_error(error: &str) -> String {
    error.lines().next().unwrap_or(error).trim().to_string()
}

fn has_meaningful_difference(original: &ShotRecord, updated: &ShotRecord) -> bool {
    original.start_time_sec != updated.start_time_sec
        || original.end_time_sec != updated.end_time_sec
        || original.description != updated.description
        || original.source_type != updated.source_type
        || original.source_name != updated.source_name
        || original.source_reference != updated.source_reference
        || original.notes != updated.notes
        || original.review_status != updated.review_status
}

fn blank_to_none(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn remove_thumbnail(path: &Option<String>) {
    if let Some(path) = path {
        let file_path = PathBuf::from(path);
        let _ = fs::remove_file(file_path);
    }
}

fn iso_timestamp() -> String {
    let output = std::process::Command::new("date")
        .args(["-u", "+%Y-%m-%dT%H:%M:%SZ"])
        .output();

    match output {
        Ok(result) if result.status.success() => {
            String::from_utf8_lossy(&result.stdout).trim().to_string()
        }
        _ => "1970-01-01T00:00:00Z".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(label: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after UNIX_EPOCH")
            .as_millis();

        std::env::temp_dir().join(format!(
            "frame-provenance-{label}-{}-{timestamp}",
            std::process::id()
        ))
    }

    fn create_cut_video(dir: &Path) -> Result<PathBuf, String> {
        let video_path = dir.join("cut-test.mp4");
        let output = Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=320x180:d=1",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=320x180:d=1",
                "-filter_complex",
                "[0:v][1:v]concat=n=2:v=1:a=0[out]",
                "-map",
                "[out]",
                "-r",
                "24",
                "-pix_fmt",
                "yuv420p",
                video_path
                    .to_str()
                    .ok_or_else(|| "invalid path".to_string())?,
            ])
            .output()
            .map_err(|error| format!("failed to start ffmpeg: {}", error))?;

        if !output.status.success() {
            return Err(format!(
                "ffmpeg failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        Ok(video_path)
    }

    #[test]
    fn analyze_provenance_generates_shots_thumbnails_and_exports() {
        let temp_dir = unique_temp_dir("analyze");
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let video_path = create_cut_video(&temp_dir).expect("generate synthetic mp4");

        let result = tauri::async_runtime::block_on(analyze_provenance(AnalyzeProvenanceRequest {
            path: video_path.to_string_lossy().into_owned(),
            sensitivity: 90.0,
        }))
        .expect("analysis should succeed");

        assert!(
            result.shots.len() >= 2,
            "expected at least one detected cut boundary"
        );

        assert!(Path::new(&result.sidecar_path).exists());
        assert!(Path::new(&result.csv_path).exists());
        assert!(Path::new(&result.thumbnail_dir).exists());

        for shot in &result.shots {
            let thumbnail_path = shot
                .thumbnail_path
                .as_ref()
                .expect("thumbnail path should be populated");
            assert!(Path::new(thumbnail_path).exists());
            assert!(shot.end_time_sec > shot.start_time_sec);
        }

        let csv = fs::read_to_string(&result.csv_path).expect("read provenance csv");
        assert!(csv.starts_with("id,videoName,startTimeSec"));
        assert!(csv.lines().count() >= result.shots.len() + 1);

        let json = fs::read_to_string(&result.sidecar_path).expect("read provenance json");
        let parsed: ProvenanceSidecar = serde_json::from_str(&json).expect("parse provenance json");
        assert_eq!(parsed.shots.len(), result.shots.len());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn analyze_provenance_rejects_unsupported_files() {
        let temp_dir = unique_temp_dir("unsupported");
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let path = temp_dir.join("notes.txt");
        fs::write(&path, "not a video").expect("write test file");

        let error = tauri::async_runtime::block_on(analyze_provenance(AnalyzeProvenanceRequest {
            path: path.to_string_lossy().into_owned(),
            sensitivity: 60.0,
        }))
        .expect_err("unsupported file should fail");

        assert!(
            error.contains("video track") || error.contains("ffprobe"),
            "unexpected error message: {error}"
        );

        let _ = fs::remove_dir_all(&temp_dir);
    }
}

/*
fn is_not_reviewed(shot: &ShotRecord) -> bool {
    shot.review_status
        .as_deref()
        .map(|value| value != "reviewed")
        .unwrap_or(true)
}

fn has_meaningful_difference(original: &ShotRecord, updated: &ShotRecord) -> bool {
    original.start_time_sec != updated.start_time_sec
        || original.end_time_sec != updated.end_time_sec
        || original.description != updated.description
        || original.source_type != updated.source_type
        || original.source_name != updated.source_name
        || original.source_reference != updated.source_reference
        || original.notes != updated.notes
        || original.review_status != updated.review_status
}

fn blank_to_none(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn normalize_shot_id(shot_id: &str) -> String {
    shot_id.trim().to_string()
}

fn shot_id(shot_id: &str) -> String {
    normalize_shot_id(shot_id)
}

fn remove_thumbnail(path: &Option<String>) {
    if let Some(path) = path {
        let file_path = PathBuf::from(path);
        let _ = fs::remove_file(file_path);
    }
}

fn iso_timestamp() -> String {
    let output = std::process::Command::new("date")
        .args(["-u", "+%Y-%m-%dT%H:%M:%SZ"])
        .output();

    match output {
        Ok(result) if result.status.success() => {
            String::from_utf8_lossy(&result.stdout).trim().to_string()
        }
        _ => "1970-01-01T00:00:00Z".to_string(),
    }
}

async fn refresh_modified_shot(
    video_path: &Path,
    thumbnail_dir: &Path,
    fps: f64,
    video_duration_sec: f64,
    shot: &ShotRecord,
) -> Result<ShotRecord, String> {
    let start_time_sec = shot.start_time_sec.max(0.0);
    let end_time_sec = normalize_end_time(start_time_sec, shot.end_time_sec, video_duration_sec);
    let thumbnail_frame_sec = midpoint(start_time_sec, end_time_sec);
    let thumbnail_path = write_thumbnail(
        video_path,
        thumbnail_dir,
        &shot.id,
        thumbnail_frame_sec,
        None,
    )
    .await?;

    Ok(ShotRecord {
        id: shot.id.clone(),
        video_name: shot.video_name.clone(),
        start_time_sec,
        end_time_sec,
        start_timecode: Some(format_timecode(start_time_sec, fps)),
        end_timecode: Some(format_timecode(end_time_sec, fps)),
        thumbnail_path: Some(thumbnail_path),
        thumbnail_frame_sec: Some(thumbnail_frame_sec),
        description: shot.description.clone(),
        source_type: shot
            .source_type
            .clone()
            .or_else(|| Some(DEFAULT_SOURCE_TYPE.to_string())),
        source_name: shot.source_name.clone(),
        source_reference: shot.source_reference.clone(),
        notes: shot.notes.clone(),
        detection_confidence: shot.detection_confidence,
        review_status: shot
            .review_status
            .clone()
            .or_else(|| Some(DEFAULT_REVIEW_STATUS.to_string())),
    })
}

fn normalize_incoming_shot(
    shot: ShotRecord,
    video_name: &str,
    fps: f64,
    video_duration_sec: f64,
    thumbnail_dir: &str,
) -> ShotRecord {
    let start_time_sec = shot.start_time_sec.max(0.0);
    let end_time_sec = normalize_end_time(start_time_sec, shot.end_time_sec, video_duration_sec);
    let thumbnail_frame_sec = shot
        .thumbnail_frame_sec
        .filter(|value| value.is_finite() && *value >= 0.0)
        .unwrap_or_else(|| midpoint(start_time_sec, end_time_sec));

    ShotRecord {
        id: shot.id.clone(),
        video_name: video_name.to_string(),
        start_time_sec,
        end_time_sec,
        start_timecode: Some(format_timecode(start_time_sec, fps)),
        end_timecode: Some(format_timecode(end_time_sec, fps)),
        thumbnail_path: Some(
            PathBuf::from(thumbnail_dir)
                .join(format!("{}.jpg", shot_id(&shot.id)))
                .to_string_lossy()
                .into_owned(),
        ),
        thumbnail_frame_sec: Some(thumbnail_frame_sec),
        description: blank_to_none(shot.description),
        source_type: shot.source_type.or_else(|| Some(DEFAULT_SOURCE_TYPE.to_string())),
        source_name: blank_to_none(shot.source_name),
        source_reference: blank_to_none(shot.source_reference),
        notes: blank_to_none(shot.notes),
        detection_confidence: shot.detection_confidence,
        review_status: shot
            .review_status
            .or_else(|| Some(DEFAULT_REVIEW_STATUS.to_string())),
    }
}

async fn refresh_all_thumbnails(
    video_path: &Path,
    thumbnail_dir: &str,
    fps: f64,
    video_duration_sec: f64,
    shots: &mut [ShotRecord],
) -> Result<(), String> {
    let thumbnail_dir = PathBuf::from(thumbnail_dir);

    for shot in shots {
        let refreshed = refresh_modified_shot(
            video_path,
            &thumbnail_dir,
            fps,
            video_duration_sec,
            shot,
        )
        .await?;
        *shot = refreshed;
    }

    Ok(())
}

async fn align_neighbors(
    shots: &mut [ShotRecord],
    index: usize,
    fps: f64,
    video_duration_sec: f64,
    video_path: &Path,
    thumbnail_dir: &str,
) -> Result<(), String> {
    if shots.is_empty() || index >= shots.len() {
        return Ok(());
    }

    if index > 0 {
        let previous_index = index - 1;
        let start_time = shots[index].start_time_sec;
        if let Some(previous) = shots.get_mut(previous_index) {
            if (previous.end_time_sec - start_time).abs() > 0.01 {
                previous.end_time_sec = start_time.max(previous.start_time_sec + MIN_SHOT_SECONDS);
                previous.review_status = Some("adjusted".to_string());
            }
        }
    }

    if index + 1 < shots.len() {
        let end_time = shots[index].end_time_sec;
        if let Some(next) = shots.get_mut(index + 1) {
            if (next.start_time_sec - end_time).abs() > 0.01 {
                next.start_time_sec = end_time.max(0.0);
                next.review_status = Some("adjusted".to_string());
            }
        }
    }

    if index > 0 {
        let previous_index = index - 1;
        let refreshed = refresh_modified_shot(
            video_path,
            &PathBuf::from(thumbnail_dir),
            fps,
            video_duration_sec,
            &shots[previous_index],
        )
        .await?;
        shots[previous_index] = refreshed;
    }

    if index + 1 < shots.len() {
        let refreshed = refresh_modified_shot(
            video_path,
            &PathBuf::from(thumbnail_dir),
            fps,
            video_duration_sec,
            &shots[index + 1],
        )
        .await?;
        shots[index + 1] = refreshed;
    }

    Ok(())
}

fn normalize_state(state: &mut ProvenanceState, fps: f64) {
    state.shots.sort_by(|left, right| {
        left.start_time_sec
            .partial_cmp(&right.start_time_sec)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.id.cmp(&right.id))
    });

    for shot in &mut state.shots {
        shot.video_name = state.video_name.clone();
        shot.start_time_sec = shot.start_time_sec.max(0.0);
        shot.end_time_sec = normalize_end_time(shot.start_time_sec, shot.end_time_sec, state.video_duration_sec);
        shot.start_timecode = Some(format_timecode(shot.start_time_sec, fps));
        shot.end_timecode = Some(format_timecode(shot.end_time_sec, fps));
        shot.thumbnail_frame_sec = Some(midpoint(shot.start_time_sec, shot.end_time_sec));
        if shot.source_type.is_none() {
            shot.source_type = Some(DEFAULT_SOURCE_TYPE.to_string());
        }
        if shot.review_status.is_none() {
            shot.review_status = Some(DEFAULT_REVIEW_STATUS.to_string());
        }
    }
}

fn persist_state(state: &ProvenanceState) -> Result<(), String> {
    let output_dir = PathBuf::from(&state.output_dir);
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("failed to create provenance output directory: {}", error))?;
    fs::create_dir_all(&state.thumbnail_dir)
        .map_err(|error| format!("failed to create thumbnail directory: {}", error))?;

    let mut shots = state.shots.clone();
    shots.sort_by(|left, right| {
        left.start_time_sec
            .partial_cmp(&right.start_time_sec)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.id.cmp(&right.id))
    });

    let sidecar = ProvenanceSidecar {
        version: PROVENANCE_VERSION,
        video_path: state.video_path.clone(),
        video_name: state.video_name.clone(),
        video_duration_sec: state.video_duration_sec,
        analyzed_at: state.analyzed_at.clone(),
        scene_threshold: state.scene_threshold,
        output_dir: state.output_dir.clone(),
        thumbnail_dir: state.thumbnail_dir.clone(),
        shots: shots.clone(),
        warnings: state.warnings.clone(),
    };

    let sidecar_bytes = serde_json::to_vec_pretty(&sidecar)
        .map_err(|error| format!("failed to serialize provenance sidecar: {}", error))?;
    fs::write(&state.sidecar_path, sidecar_bytes)
        .map_err(|error| format!("failed to write provenance sidecar: {}", error))?;

    fs::write(&state.csv_path, build_csv(&shots))
        .map_err(|error| format!("failed to write provenance csv: {}", error))?;

    Ok(())
}

fn build_csv(shots: &[ShotRecord]) -> String {
    let mut csv = String::from(
        "id,videoName,startTimeSec,endTimeSec,startTimecode,endTimecode,thumbnailPath,thumbnailFrameSec,description,sourceType,sourceName,sourceReference,notes,detectionConfidence,reviewStatus\n",
    );

    for shot in shots {
        let line = [
            csv_escape(&shot.id),
            csv_escape(&shot.video_name),
            format_decimal(shot.start_time_sec),
            format_decimal(shot.end_time_sec),
            csv_escape(shot.start_timecode.as_deref().unwrap_or_default()),
            csv_escape(shot.end_timecode.as_deref().unwrap_or_default()),
            csv_escape(shot.thumbnail_path.as_deref().unwrap_or_default()),
            shot.thumbnail_frame_sec
                .map(format_decimal)
                .unwrap_or_default(),
            csv_escape(shot.description.as_deref().unwrap_or_default()),
            csv_escape(shot.source_type.as_deref().unwrap_or_default()),
            csv_escape(shot.source_name.as_deref().unwrap_or_default()),
            csv_escape(shot.source_reference.as_deref().unwrap_or_default()),
            csv_escape(shot.notes.as_deref().unwrap_or_default()),
            format_decimal(shot.detection_confidence),
            csv_escape(shot.review_status.as_deref().unwrap_or_default()),
        ]
        .join(",");
        csv.push_str(&line);
        csv.push('\n');
    }

    csv
}

async fn write_thumbnail(
    video_path: &Path,
    thumbnail_dir: &Path,
    shot_id: &str,
    frame_sec: f64,
    source_thumbnail_path: Option<&str>,
) -> Result<String, String> {
    fs::create_dir_all(thumbnail_dir)
        .map_err(|error| format!("failed to create thumbnail directory: {}", error))?;

    let thumbnail_path = thumbnail_dir.join(format!("{}.jpg", shot_id));
    if thumbnail_path.exists() {
        fs::remove_file(&thumbnail_path)
            .map_err(|error| format!("failed to replace thumbnail {}: {}", shot_id, error))?;
    }

    if let Some(source_path) = source_thumbnail_path {
        let source = PathBuf::from(source_path);
        if source.exists() {
            fs::copy(&source, &thumbnail_path).map_err(|error| {
                format!(
                    "failed to copy thumbnail for {} into provenance output: {}",
                    shot_id, error
                )
            })?;
            let _ = fs::remove_file(source);
            return Ok(thumbnail_path.to_string_lossy().into_owned());
        }
    }

    let temp_thumbnail = extract_thumbnail(video_path.to_string_lossy().into_owned(), frame_sec)
        .await
        .map_err(|error| summarize_error(&error))?;
    let source = PathBuf::from(temp_thumbnail.path);

    fs::copy(&source, &thumbnail_path).map_err(|error| {
        format!(
            "failed to write provenance thumbnail for {}: {}",
            shot_id, error
        )
    })?;
    let _ = fs::remove_file(source);

    Ok(thumbnail_path.to_string_lossy().into_owned())
}

fn midpoint(start_time_sec: f64, end_time_sec: f64) -> f64 {
    let duration = (end_time_sec - start_time_sec).max(MIN_SHOT_SECONDS);
    start_time_sec + (duration / 2.0)
}

fn normalize_end_time(start_time_sec: f64, end_time_sec: f64, video_duration_sec: f64) -> f64 {
    let lower_bound = start_time_sec + MIN_SHOT_SECONDS;
    let candidate = if video_duration_sec > 0.0 {
        end_time_sec.min(video_duration_sec)
    } else {
        end_time_sec
    };

    candidate.max(lower_bound)
}

fn build_shot_record(
    id: &str,
    video_name: &str,
    start_time_sec: f64,
    end_time_sec: f64,
    thumbnail_frame_sec: f64,
    thumbnail_path: String,
    detection_confidence: f64,
    fps: f64,
) -> ShotRecord {
    ShotRecord {
        id: id.to_string(),
        video_name: video_name.to_string(),
        start_time_sec,
        end_time_sec,
        start_timecode: Some(format_timecode(start_time_sec, fps)),
        end_timecode: Some(format_timecode(end_time_sec, fps)),
        thumbnail_path: Some(thumbnail_path),
        thumbnail_frame_sec: Some(thumbnail_frame_sec),
        description: None,
        source_type: Some(DEFAULT_SOURCE_TYPE.to_string()),
        source_name: None,
        source_reference: None,
        notes: None,
        detection_confidence,
        review_status: Some(DEFAULT_REVIEW_STATUS.to_string()),
    }
}

fn fallback_scene(duration_sec: f64) -> crate::models::Scene {
    crate::models::Scene {
        index: 1,
        start_time: 0.0,
        end_time: duration_sec.max(1.0),
        confidence: 58.0,
        thumbnail_color: "#334155".to_string(),
        thumbnail_path: None,
    }
}

fn csv_escape(value: &str) -> String {
    let needs_quotes = value.contains(',') || value.contains('"') || value.contains('\n');
    if needs_quotes {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn format_decimal(value: f64) -> String {
    let formatted = format!("{:.3}", value.max(0.0));
    formatted.trim_end_matches('0').trim_end_matches('.').to_string()
}

fn format_timecode(total_seconds: f64, fps: f64) -> String {
    let safe_seconds = total_seconds.max(0.0);
    let safe_fps = if fps.is_finite() && fps > 0.0 { fps } else { 24.0 };
    let whole_seconds = safe_seconds.floor();
    let hours = (whole_seconds / 3600.0).floor() as u64;
    let minutes = ((whole_seconds % 3600.0) / 60.0).floor() as u64;
    let seconds = (whole_seconds % 60.0).floor() as u64;
    let frames = ((safe_seconds - whole_seconds) * safe_fps).floor() as u64;

    format!("{:02}:{:02}:{:02}:{:02}", hours, minutes, seconds, frames)
}

fn scene_threshold(sensitivity: f64) -> f64 {
    let normalized = sensitivity.clamp(1.0, 100.0) / 100.0;
    (0.62 - (normalized * 0.47)).clamp(0.12, 0.62)
}

fn resolve_video_path(video_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(video_path);
    if !path.exists() {
        return Err(format!("video path was not found: {}", video_path));
    }

    if !path.is_file() {
        return Err(format!("video path is not a file: {}", video_path));
    }

    Ok(path)
}

fn output_dir_for_video(video_path: &Path) -> Result<PathBuf, String> {
    let parent = video_path
        .parent()
        .ok_or_else(|| "the selected video must live on disk".to_string())?;
    Ok(parent.join(format!("{}{}", video_stem(video_path)?, OUTPUT_SUFFIX)))
}

fn sidecar_path_for_video(video_path: &Path) -> Result<PathBuf, String> {
    Ok(output_dir_for_video(video_path)?.join(SIDECAR_FILE_NAME))
}

fn sidecar_path_for_output(output_dir: &Path) -> PathBuf {
    output_dir.join(SIDECAR_FILE_NAME)
}

fn csv_path_for_output(output_dir: &Path) -> PathBuf {
    output_dir.join(CSV_FILE_NAME)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn video_stem(video_path: &Path) -> Result<String, String> {
    video_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "the selected video must have a file name".to_string())
}

fn clear_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(path)
        .map_err(|error| format!("failed to read provenance output directory: {}", error))?
    {
        let entry = entry.map_err(|error| format!("failed to read provenance output entry: {}", error))?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            fs::remove_dir_all(&entry_path)
                .map_err(|error| format!("failed to remove old provenance directory: {}", error))?;
        } else {
            fs::remove_file(&entry_path)
                .map_err(|error| format!("failed to remove old provenance file: {}", error))?;
        }
    }

    Ok(())
}

fn summarize_error(error: &str) -> String {
    error.lines().next().unwrap_or(error).trim().to_string()
}

fn blank_to_none(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn remove_thumbnail(path: &Option<String>) {
    if let Some(path) = path {
        let file_path = PathBuf::from(path);
        let _ = fs::remove_file(file_path);
    }
}

fn to_state(video_path: &Path, sidecar: ProvenanceSidecar) -> ProvenanceState {
    let output_dir = PathBuf::from(&sidecar.output_dir);
    ProvenanceState {
        video_path: video_path.to_string_lossy().into_owned(),
        video_name: sidecar.video_name,
        video_duration_sec: sidecar.video_duration_sec,
        analyzed_at: sidecar.analyzed_at,
        scene_threshold: sidecar.scene_threshold,
        output_dir: output_dir.to_string_lossy().into_owned(),
        thumbnail_dir: PathBuf::from(&sidecar.thumbnail_dir)
            .to_string_lossy()
            .into_owned(),
        sidecar_path: sidecar_path_for_output(&output_dir)
            .to_string_lossy()
            .into_owned(),
        csv_path: csv_path_for_output(&output_dir).to_string_lossy().into_owned(),
        shots: sidecar.shots,
        warnings: sidecar.warnings,
    }
}

fn load_state(video_path: &Path) -> Result<ProvenanceState, String> {
    let sidecar_path = sidecar_path_for_video(video_path)?;
    let bytes = fs::read(&sidecar_path)
        .map_err(|error| format!("failed to read provenance sidecar: {}", error))?;
    let sidecar = serde_json::from_slice::<ProvenanceSidecar>(&bytes)
        .map_err(|error| format!("failed to parse provenance sidecar: {}", error))?;
    Ok(to_state(video_path, sidecar))
}

fn has_meaningful_difference(left: &ShotRecord, right: &ShotRecord) -> bool {
    left.start_time_sec != right.start_time_sec
        || left.end_time_sec != right.end_time_sec
        || left.description != right.description
        || left.source_type != right.source_type
        || left.source_name != right.source_name
        || left.source_reference != right.source_reference
        || left.notes != right.notes
        || left.review_status != right.review_status
}
*/
