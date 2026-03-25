use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

use crate::models::{Transcript, TranscriptSegment};

#[tauri::command]
pub async fn transcribe(path: String, model: String) -> Result<Transcript, String> {
    match transcribe_if_available(&path, &model)? {
        Some(transcript) => Ok(transcript),
        None => Err(transcription_unavailable_message(&model)),
    }
}

pub(crate) fn transcribe_if_available(
    path: &str,
    model: &str,
) -> Result<Option<Transcript>, String> {
    if !whisper_cli_available() {
        return Ok(None);
    }

    let Some(model_path) = local_model_path(model)? else {
        return Ok(None);
    };

    Ok(Some(run_whisper(path, &model_path)?))
}

fn run_whisper(path: &str, model_path: &Path) -> Result<Transcript, String> {
    let audio_path = extract_audio_for_whisper(path)?;
    let out_prefix = std::env::temp_dir().join(format!("frame_whisper_{}", std::process::id()));
    let out_json = out_prefix.with_extension("json");

    let output = Command::new("whisper-cli")
        .args([
            "-m",
            &path_to_string(model_path),
            "-f",
            &path_to_string(&audio_path),
            "-oj",
            "-of",
            &path_to_string(&out_prefix),
        ])
        .output()
        .map_err(|e| format!("whisper-cli failed to start: {}", e))?;

    let _ = std::fs::remove_file(&audio_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = std::fs::remove_file(&out_json);
        return Err(format!(
            "whisper-cli transcription failed: {}",
            stderr.trim()
        ));
    }

    let json_content = std::fs::read_to_string(&out_json)
        .map_err(|e| format!("failed to read whisper output: {}", e))?;
    let _ = std::fs::remove_file(&out_json);

    parse_transcript(&json_content)
}

fn parse_transcript(json_content: &str) -> Result<Transcript, String> {
    let parsed: Value = serde_json::from_str(json_content)
        .map_err(|e| format!("failed to parse whisper JSON: {}", e))?;

    let segments_value = parsed
        .get("transcription")
        .and_then(|value| value.get("segments"))
        .or_else(|| parsed.get("segments"))
        .or_else(|| parsed.get("result").and_then(|value| value.get("segments")));

    let mut segments = segments_value
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .enumerate()
                .map(|(index, segment)| TranscriptSegment {
                    id: segment
                        .get("id")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                        .unwrap_or_else(|| format!("seg-{}", index)),
                    start_time: parse_segment_time(segment, &["start", "from"], "from"),
                    end_time: parse_segment_time(segment, &["end", "to"], "to"),
                    speaker: segment
                        .get("speaker")
                        .and_then(Value::as_str)
                        .unwrap_or(if index % 2 == 0 { "A" } else { "B" })
                        .to_string(),
                    text: segment
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string(),
                })
                .filter(|segment| !segment.text.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if segments.is_empty() {
        if let Some(text) = parsed.get("text").and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                segments.push(TranscriptSegment {
                    id: "seg-0".to_string(),
                    start_time: 0.0,
                    end_time: 0.0,
                    speaker: "A".to_string(),
                    text: trimmed.to_string(),
                });
            }
        }
    }

    let language = parsed
        .get("transcription")
        .and_then(|value| value.get("language"))
        .or_else(|| parsed.get("language"))
        .or_else(|| parsed.get("result").and_then(|value| value.get("language")))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();

    Ok(Transcript { language, segments })
}

fn parse_segment_time(segment: &Value, direct_keys: &[&str], timestamp_key: &str) -> f64 {
    for key in direct_keys {
        if let Some(value) = segment.get(*key).and_then(value_to_seconds) {
            return value;
        }
    }

    segment
        .get("timestamps")
        .and_then(|value| value.get(timestamp_key))
        .and_then(value_to_seconds)
        .unwrap_or(0.0)
}

fn value_to_seconds(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|entry| entry as f64))
        .or_else(|| value.as_str().and_then(parse_whisper_time))
}

fn parse_whisper_time(value: &str) -> Option<f64> {
    let parts: Vec<&str> = value.split(':').collect();
    match parts.as_slice() {
        [minutes, seconds] => {
            Some(minutes.parse::<f64>().ok()? * 60.0 + seconds.parse::<f64>().ok()?)
        }
        [hours, minutes, seconds] => Some(
            hours.parse::<f64>().ok()? * 3600.0
                + minutes.parse::<f64>().ok()? * 60.0
                + seconds.parse::<f64>().ok()?,
        ),
        _ => value.parse::<f64>().ok(),
    }
}

fn whisper_cli_available() -> bool {
    Command::new("whisper-cli").arg("--help").output().is_ok()
}

fn local_model_path(model: &str) -> Result<Option<PathBuf>, String> {
    let home = dirs::home_dir().ok_or("cannot find home directory")?;
    let model_dir = home.join(".frame/models/whisper");

    let known_names = match model {
        "tiny" => ["ggml-tiny.bin", "tiny.bin"],
        "base" => ["ggml-base.bin", "base.bin"],
        "small" => ["ggml-small.bin", "small.bin"],
        "medium" => ["ggml-medium.bin", "medium.bin"],
        _ => {
            return Err(format!(
                "unknown whisper model: {}. Use tiny, base, small, or medium.",
                model
            ))
        }
    };

    Ok(known_names
        .iter()
        .map(|name| model_dir.join(name))
        .find(|candidate| candidate.exists()))
}

fn extract_audio_for_whisper(path: &str) -> Result<PathBuf, String> {
    let out_path =
        std::env::temp_dir().join(format!("frame_whisper_audio_{}.wav", std::process::id()));

    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            path,
            "-vn",
            "-ar",
            "16000",
            "-ac",
            "1",
            &path_to_string(&out_path),
        ])
        .output()
        .map_err(|e| format!("failed to prepare audio for whisper: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "failed to prepare audio for whisper: {}",
            stderr.trim()
        ));
    }

    Ok(out_path)
}

fn transcription_unavailable_message(model: &str) -> String {
    format!(
        "transcription requires local whisper.cpp support. Install `whisper-cli` and place the {} model in ~/.frame/models/whisper/",
        model
    )
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
