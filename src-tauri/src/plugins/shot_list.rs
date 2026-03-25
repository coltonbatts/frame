use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::plugin::TauriPlugin;
use tauri::Runtime;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

const SIDECAR_VERSION: u8 = 1;
const MANIFEST_JSON_FILE_NAME: &str = "manifest.json";
const MANIFEST_CSV_FILE_NAME: &str = "manifest.csv";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotRecord {
    pub shot_number: usize,
    pub timestamp_seconds: f64,
    pub timestamp_readable: String,
    pub scene_label: String,
    pub thumbnail_name: String,
    pub thumbnail_path: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotListState {
    pub video_path: String,
    pub sidecar_path: String,
    pub output_dir: String,
    pub manifest_json_path: String,
    pub manifest_csv_path: String,
    pub shots: Vec<ShotRecord>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShotListSidecar {
    version: u8,
    video_path: String,
    output_dir: String,
    shots: Vec<ShotRecord>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestEntry {
    shot_number: usize,
    timestamp_seconds: f64,
    timestamp_readable: String,
    scene_label: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureShotRequest {
    video_path: String,
    timestamp_seconds: f64,
    fps: f64,
    scene_label: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateShotLabelRequest {
    video_path: String,
    shot_number: usize,
    scene_label: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteShotRequest {
    video_path: String,
    shot_number: usize,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetShotOutputDirectoryRequest {
    video_path: String,
    output_dir: String,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("shot-list")
        .invoke_handler(tauri::generate_handler![
            load_shot_list,
            capture_shot,
            update_shot_label,
            delete_shot,
            set_shot_output_directory,
            export_shot_list_zip
        ])
        .build()
}

#[tauri::command]
pub async fn load_shot_list(video_path: String) -> Result<ShotListState, String> {
    tauri::async_runtime::spawn_blocking(move || load_shot_list_blocking(video_path))
        .await
        .map_err(|error| format!("shot list worker failed to join: {}", error))?
}

#[tauri::command]
pub async fn capture_shot(request: CaptureShotRequest) -> Result<ShotListState, String> {
    tauri::async_runtime::spawn_blocking(move || capture_shot_blocking(request))
        .await
        .map_err(|error| format!("shot capture worker failed to join: {}", error))?
}

#[tauri::command]
pub async fn update_shot_label(request: UpdateShotLabelRequest) -> Result<ShotListState, String> {
    tauri::async_runtime::spawn_blocking(move || update_shot_label_blocking(request))
        .await
        .map_err(|error| format!("shot label worker failed to join: {}", error))?
}

#[tauri::command]
pub async fn delete_shot(request: DeleteShotRequest) -> Result<ShotListState, String> {
    tauri::async_runtime::spawn_blocking(move || delete_shot_blocking(request))
        .await
        .map_err(|error| format!("shot delete worker failed to join: {}", error))?
}

#[tauri::command]
pub async fn set_shot_output_directory(
    request: SetShotOutputDirectoryRequest,
) -> Result<ShotListState, String> {
    tauri::async_runtime::spawn_blocking(move || set_shot_output_directory_blocking(request))
        .await
        .map_err(|error| format!("shot output worker failed to join: {}", error))?
}

#[tauri::command]
pub async fn export_shot_list_zip(video_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || export_shot_list_zip_blocking(video_path))
        .await
        .map_err(|error| format!("shot export worker failed to join: {}", error))?
}

fn load_shot_list_blocking(video_path: String) -> Result<ShotListState, String> {
    let video_path = resolve_video_path(&video_path)?;
    let sidecar = load_sidecar(&video_path)?;
    Ok(to_client_state(&video_path, &sidecar))
}

fn capture_shot_blocking(request: CaptureShotRequest) -> Result<ShotListState, String> {
    let video_path = resolve_video_path(&request.video_path)?;
    let mut sidecar = load_sidecar(&video_path)?;
    fs::create_dir_all(&sidecar.output_dir)
        .map_err(|error| format!("failed to create shot folder: {}", error))?;

    let shot_number = sidecar.shots.len() + 1;
    let thumbnail_name = shot_file_name(shot_number);
    let thumbnail_path = PathBuf::from(&sidecar.output_dir).join(&thumbnail_name);

    extract_png_frame(&video_path, request.timestamp_seconds, &thumbnail_path)?;

    sidecar.shots.push(ShotRecord {
        shot_number,
        timestamp_seconds: request.timestamp_seconds.max(0.0),
        timestamp_readable: format_timestamp_readable(request.timestamp_seconds, request.fps),
        scene_label: clean_scene_label(request.scene_label.unwrap_or_default()),
        thumbnail_name,
        thumbnail_path: thumbnail_path.to_string_lossy().into_owned(),
    });

    persist_sidecar(&video_path, &mut sidecar)
}

fn update_shot_label_blocking(request: UpdateShotLabelRequest) -> Result<ShotListState, String> {
    let video_path = resolve_video_path(&request.video_path)?;
    let mut sidecar = load_sidecar(&video_path)?;
    let shot = sidecar
        .shots
        .iter_mut()
        .find(|entry| entry.shot_number == request.shot_number)
        .ok_or_else(|| format!("shot {} was not found", request.shot_number))?;

    shot.scene_label = clean_scene_label(request.scene_label);
    persist_sidecar(&video_path, &mut sidecar)
}

fn delete_shot_blocking(request: DeleteShotRequest) -> Result<ShotListState, String> {
    let video_path = resolve_video_path(&request.video_path)?;
    let mut sidecar = load_sidecar(&video_path)?;
    let index = sidecar
        .shots
        .iter()
        .position(|entry| entry.shot_number == request.shot_number)
        .ok_or_else(|| format!("shot {} was not found", request.shot_number))?;

    let removed = sidecar.shots.remove(index);
    let removed_path = PathBuf::from(&removed.thumbnail_path);
    if removed_path.exists() {
        fs::remove_file(&removed_path)
            .map_err(|error| format!("failed to remove {}: {}", removed.thumbnail_name, error))?;
    }

    persist_sidecar(&video_path, &mut sidecar)
}

fn set_shot_output_directory_blocking(
    request: SetShotOutputDirectoryRequest,
) -> Result<ShotListState, String> {
    let video_path = resolve_video_path(&request.video_path)?;
    let mut sidecar = load_sidecar(&video_path)?;
    let old_output_dir = PathBuf::from(&sidecar.output_dir);
    let next_output_dir = PathBuf::from(&request.output_dir);

    if next_output_dir.as_os_str().is_empty() {
        return Err("choose a folder before updating the shot list output".to_string());
    }

    sidecar.output_dir = next_output_dir.to_string_lossy().into_owned();
    let state = persist_sidecar(&video_path, &mut sidecar)?;

    if old_output_dir != next_output_dir {
        cleanup_old_output_dir(&old_output_dir);
    }

    Ok(state)
}

fn export_shot_list_zip_blocking(video_path: String) -> Result<String, String> {
    let video_path = resolve_video_path(&video_path)?;
    let mut sidecar = load_sidecar(&video_path)?;

    if sidecar.shots.is_empty() {
        return Err("capture at least one shot before exporting a zip".to_string());
    }

    let state = persist_sidecar(&video_path, &mut sidecar)?;
    let zip_path = PathBuf::from(&state.output_dir)
        .join(format!("{}_shot_list.zip", video_stem(&video_path)?));

    let file = fs::File::create(&zip_path)
        .map_err(|error| format!("failed to create zip export: {}", error))?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    add_file_to_zip(
        &mut writer,
        Path::new(&state.manifest_json_path),
        MANIFEST_JSON_FILE_NAME,
        options,
    )?;
    add_file_to_zip(
        &mut writer,
        Path::new(&state.manifest_csv_path),
        MANIFEST_CSV_FILE_NAME,
        options,
    )?;

    for shot in &state.shots {
        add_file_to_zip(
            &mut writer,
            Path::new(&shot.thumbnail_path),
            &shot.thumbnail_name,
            options,
        )?;
    }

    writer
        .finish()
        .map_err(|error| format!("failed to finalize zip export: {}", error))?;

    Ok(zip_path.to_string_lossy().into_owned())
}

fn add_file_to_zip(
    writer: &mut ZipWriter<fs::File>,
    path: &Path,
    name: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("failed to read {} for zip export: {}", name, error))?;

    writer
        .start_file(name, options)
        .map_err(|error| format!("failed to add {} to zip export: {}", name, error))?;
    writer
        .write_all(&bytes)
        .map_err(|error| format!("failed to write {} to zip export: {}", name, error))
}

fn load_sidecar(video_path: &Path) -> Result<ShotListSidecar, String> {
    let sidecar_path = sidecar_path(video_path)?;

    let mut sidecar = if sidecar_path.exists() {
        let bytes = fs::read(&sidecar_path)
            .map_err(|error| format!("failed to read shot list sidecar: {}", error))?;
        serde_json::from_slice::<ShotListSidecar>(&bytes)
            .map_err(|error| format!("failed to parse shot list sidecar: {}", error))?
    } else {
        ShotListSidecar {
            version: SIDECAR_VERSION,
            video_path: video_path.to_string_lossy().into_owned(),
            output_dir: default_output_dir(video_path)?
                .to_string_lossy()
                .into_owned(),
            shots: Vec::new(),
        }
    };

    if sidecar.output_dir.trim().is_empty() {
        sidecar.output_dir = default_output_dir(video_path)?
            .to_string_lossy()
            .into_owned();
    }

    sidecar.video_path = video_path.to_string_lossy().into_owned();
    normalize_shots(&mut sidecar)?;
    Ok(sidecar)
}

fn persist_sidecar(
    video_path: &Path,
    sidecar: &mut ShotListSidecar,
) -> Result<ShotListState, String> {
    normalize_shots(sidecar)?;

    let output_dir = PathBuf::from(&sidecar.output_dir);
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("failed to create shot folder: {}", error))?;

    let manifest_entries = sidecar
        .shots
        .iter()
        .map(|shot| ManifestEntry {
            shot_number: shot.shot_number,
            timestamp_seconds: shot.timestamp_seconds,
            timestamp_readable: shot.timestamp_readable.clone(),
            scene_label: shot.scene_label.clone(),
        })
        .collect::<Vec<_>>();

    let manifest_json_path = manifest_json_path(sidecar);
    let manifest_csv_path = manifest_csv_path(sidecar);

    let manifest_json = serde_json::to_vec_pretty(&manifest_entries)
        .map_err(|error| format!("failed to serialize shot manifest: {}", error))?;
    fs::write(&manifest_json_path, manifest_json)
        .map_err(|error| format!("failed to write shot manifest json: {}", error))?;

    fs::write(&manifest_csv_path, build_manifest_csv(&manifest_entries))
        .map_err(|error| format!("failed to write shot manifest csv: {}", error))?;

    let sidecar_path = sidecar_path(video_path)?;
    let sidecar_bytes = serde_json::to_vec_pretty(sidecar)
        .map_err(|error| format!("failed to serialize shot sidecar: {}", error))?;
    fs::write(&sidecar_path, sidecar_bytes)
        .map_err(|error| format!("failed to write shot sidecar: {}", error))?;

    Ok(to_client_state(video_path, sidecar))
}

fn normalize_shots(sidecar: &mut ShotListSidecar) -> Result<(), String> {
    let mut shots = std::mem::take(&mut sidecar.shots);
    shots.sort_by_key(|shot| shot.shot_number);

    let output_dir = PathBuf::from(&sidecar.output_dir);
    let mut normalized = Vec::with_capacity(shots.len());

    for shot in shots {
        let old_path = PathBuf::from(&shot.thumbnail_path);
        let expected_number = normalized.len() + 1;
        let expected_name = shot_file_name(expected_number);
        let expected_path = output_dir.join(&expected_name);

        let current_path = if old_path.exists() {
            old_path
        } else if expected_path.exists() {
            expected_path.clone()
        } else {
            continue;
        };

        move_file_if_needed(&current_path, &expected_path)?;

        normalized.push(ShotRecord {
            shot_number: expected_number,
            timestamp_seconds: shot.timestamp_seconds.max(0.0),
            timestamp_readable: shot.timestamp_readable,
            scene_label: clean_scene_label(shot.scene_label),
            thumbnail_name: expected_name,
            thumbnail_path: expected_path.to_string_lossy().into_owned(),
        });
    }

    sidecar.version = SIDECAR_VERSION;
    sidecar.shots = normalized;
    Ok(())
}

fn move_file_if_needed(from: &Path, to: &Path) -> Result<(), String> {
    if from == to {
        return Ok(());
    }

    if !from.exists() {
        return Err(format!(
            "expected frame {} but it is missing",
            from.to_string_lossy()
        ));
    }

    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create output directory: {}", error))?;
    }

    if to.exists() {
        fs::remove_file(to)
            .map_err(|error| format!("failed to replace {}: {}", to.to_string_lossy(), error))?;
    }

    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(from, to)
                .map_err(|error| format!("failed to copy frame into output folder: {}", error))?;
            fs::remove_file(from)
                .map_err(|error| format!("failed to clean up old frame path: {}", error))
        }
    }
}

fn extract_png_frame(
    video_path: &Path,
    timestamp_seconds: f64,
    output_path: &Path,
) -> Result<(), String> {
    if output_path.exists() {
        fs::remove_file(output_path).map_err(|error| {
            format!(
                "failed to clear existing shot file {}: {}",
                output_path.to_string_lossy(),
                error
            )
        })?;
    }

    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            &format!("{:.3}", timestamp_seconds.max(0.0)),
            "-i",
            video_path
                .to_str()
                .ok_or_else(|| "invalid video path".to_string())?,
            "-frames:v",
            "1",
            "-an",
        ])
        .arg(output_path)
        .output()
        .map_err(|error| format!("failed to start ffmpeg for shot capture: {}", error))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "ffmpeg shot capture failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn build_manifest_csv(entries: &[ManifestEntry]) -> String {
    let mut csv = String::from("shot_number,timestamp_seconds,timestamp_readable,scene_label\n");

    for entry in entries {
        let line = format!(
            "{},{},{},{}\n",
            entry.shot_number,
            format_decimal(entry.timestamp_seconds),
            csv_escape(&entry.timestamp_readable),
            csv_escape(&entry.scene_label),
        );
        csv.push_str(&line);
    }

    csv
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

fn clean_scene_label(value: String) -> String {
    value.trim().to_string()
}

fn format_timestamp_readable(total_seconds: f64, fps: f64) -> String {
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

fn to_client_state(video_path: &Path, sidecar: &ShotListSidecar) -> ShotListState {
    let manifest_json_path = manifest_json_path(sidecar);
    let manifest_csv_path = manifest_csv_path(sidecar);

    ShotListState {
        video_path: video_path.to_string_lossy().into_owned(),
        sidecar_path: sidecar_path(video_path)
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        output_dir: sidecar.output_dir.clone(),
        manifest_json_path: manifest_json_path.to_string_lossy().into_owned(),
        manifest_csv_path: manifest_csv_path.to_string_lossy().into_owned(),
        shots: sidecar.shots.clone(),
    }
}

fn manifest_json_path(sidecar: &ShotListSidecar) -> PathBuf {
    PathBuf::from(&sidecar.output_dir).join(MANIFEST_JSON_FILE_NAME)
}

fn manifest_csv_path(sidecar: &ShotListSidecar) -> PathBuf {
    PathBuf::from(&sidecar.output_dir).join(MANIFEST_CSV_FILE_NAME)
}

fn sidecar_path(video_path: &Path) -> Result<PathBuf, String> {
    let parent = video_path
        .parent()
        .ok_or_else(|| "the selected video must live on disk".to_string())?;
    let file_name = video_path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "the selected video must have a file name".to_string())?;

    Ok(parent.join(format!(".{}.frameshots.json", file_name)))
}

fn default_output_dir(video_path: &Path) -> Result<PathBuf, String> {
    let parent = video_path
        .parent()
        .ok_or_else(|| "the selected video must live on disk".to_string())?;
    Ok(parent.join(format!("{}_frameshots", video_stem(video_path)?)))
}

fn video_stem(video_path: &Path) -> Result<String, String> {
    video_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "the selected video must have a file name".to_string())
}

fn shot_file_name(shot_number: usize) -> String {
    format!("shot_{:03}.png", shot_number)
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

fn cleanup_old_output_dir(path: &Path) {
    let manifest_json = path.join(MANIFEST_JSON_FILE_NAME);
    let manifest_csv = path.join(MANIFEST_CSV_FILE_NAME);
    let _ = fs::remove_file(manifest_json);
    let _ = fs::remove_file(manifest_csv);
    let _ = fs::remove_dir(path);
}
