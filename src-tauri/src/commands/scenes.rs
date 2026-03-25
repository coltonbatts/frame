use std::cmp::Ordering;
use std::process::Command;

use crate::commands::files::{extract_thumbnail, probe_media};
use crate::models::Scene;

const DEFAULT_SCENE_COLOR: &str = "#334155";
const MAX_SCENES: usize = 24;

#[derive(Clone, Copy)]
struct SceneCut {
    time: f64,
    score: f64,
}

#[tauri::command]
pub async fn detect_scenes(path: String, sensitivity: f64) -> Result<Vec<Scene>, String> {
    let probe = probe_media(&path)?;

    if !probe.has_video {
        return Ok(Vec::new());
    }

    let threshold = scene_threshold(sensitivity);
    let filter = format!("select='gt(scene,{threshold:.3})',metadata=mode=print:file=-");

    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "info",
            "-i",
            &path,
            "-filter:v",
            &filter,
            "-an",
            "-f",
            "null",
            "-",
        ])
        .output()
        .map_err(|e| format!("scene detection failed to start: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("scene detection failed: {}", stderr.trim()));
    }

    let mut cuts = parse_scene_cuts(&String::from_utf8_lossy(&output.stdout));

    if cuts.is_empty() {
        cuts = parse_scene_cuts(&String::from_utf8_lossy(&output.stderr));
    }

    cuts = collapse_cuts(cuts, probe.duration);

    let mut ranges = Vec::with_capacity(cuts.len() + 1);
    let mut start_time = 0.0;
    let mut previous_score = 0.82;

    for cut in cuts {
        ranges.push((start_time, cut.time.max(start_time + 0.25), previous_score));
        start_time = cut.time;
        previous_score = cut.score;
    }

    let end_time = if probe.duration > 0.0 {
        probe.duration
    } else {
        start_time + 1.0
    };
    ranges.push((start_time, end_time.max(start_time + 0.25), previous_score));

    let mut scenes = Vec::with_capacity(ranges.len());
    for (index, (start_time, end_time, score)) in ranges.into_iter().enumerate() {
        let midpoint = start_time + ((end_time - start_time) / 2.0);
        let thumbnail_color = sample_thumbnail_color(&path, midpoint)
            .unwrap_or_else(|_| DEFAULT_SCENE_COLOR.to_string());
        let thumbnail_path = extract_thumbnail(path.clone(), midpoint)
            .await
            .ok()
            .map(|thumbnail| thumbnail.path);

        scenes.push(Scene {
            index: index + 1,
            start_time,
            end_time,
            confidence: scene_confidence(score),
            thumbnail_color,
            thumbnail_path,
        });
    }

    Ok(scenes)
}

fn scene_threshold(sensitivity: f64) -> f64 {
    let normalized = sensitivity.clamp(1.0, 100.0) / 100.0;
    (0.62 - (normalized * 0.47)).clamp(0.12, 0.62)
}

fn scene_confidence(score: f64) -> f64 {
    ((score.clamp(0.0, 1.0) * 45.0) + 55.0).round()
}

fn parse_scene_cuts(output: &str) -> Vec<SceneCut> {
    let mut current_time = None;
    let mut cuts = Vec::new();

    for line in output.lines() {
        if let Some(time) = parse_number_after(line, "pts_time:") {
            current_time = Some(time);
        }

        if let Some(score) = parse_number_after(line, "lavfi.scene_score=") {
            if let Some(time) = current_time.take() {
                cuts.push(SceneCut { time, score });
            }
        }
    }

    cuts
}

fn parse_number_after(line: &str, marker: &str) -> Option<f64> {
    let (_, tail) = line.split_once(marker)?;
    let value = tail
        .split_whitespace()
        .next()?
        .trim_end_matches(|character: char| !character.is_ascii_digit() && character != '.');
    value.parse::<f64>().ok()
}

fn collapse_cuts(mut cuts: Vec<SceneCut>, duration: f64) -> Vec<SceneCut> {
    cuts.retain(|cut| cut.time > 0.5 && (duration <= 0.0 || cut.time < (duration - 0.5).max(0.0)));
    cuts.sort_by(|left, right| {
        left.time
            .partial_cmp(&right.time)
            .unwrap_or(Ordering::Equal)
    });

    let min_gap = if duration > 0.0 {
        (duration / 80.0).clamp(1.0, 6.0)
    } else {
        1.5
    };

    let mut collapsed: Vec<SceneCut> = Vec::new();
    for cut in cuts {
        if let Some(last) = collapsed.last_mut() {
            if cut.time - last.time < min_gap {
                if cut.score > last.score {
                    *last = cut;
                }
                continue;
            }
        }

        collapsed.push(cut);
    }

    if collapsed.len() > MAX_SCENES.saturating_sub(1) {
        collapsed.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
        });
        collapsed.truncate(MAX_SCENES - 1);
        collapsed.sort_by(|left, right| {
            left.time
                .partial_cmp(&right.time)
                .unwrap_or(Ordering::Equal)
        });
    }

    collapsed
}

fn sample_thumbnail_color(path: &str, time: f64) -> Result<String, String> {
    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &format!("{time:.3}"),
            "-i",
            path,
            "-frames:v",
            "1",
            "-vf",
            "scale=1:1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ])
        .output()
        .map_err(|e| format!("thumbnail color sampling failed to start: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "thumbnail color sampling failed: {}",
            stderr.trim()
        ));
    }

    if output.stdout.len() < 3 {
        return Err("thumbnail color sampling produced no frame".to_string());
    }

    Ok(format!(
        "#{:02X}{:02X}{:02X}",
        output.stdout[0], output.stdout[1], output.stdout[2]
    ))
}
