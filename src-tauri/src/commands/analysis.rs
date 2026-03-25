use std::process::Command;

use crate::commands::files::probe_media;
use crate::commands::scenes::detect_scenes;
use crate::commands::whisper::transcribe_if_available;
use crate::models::{AnalysisPayload, AnalysisResult, Scene, Transcript};

const DEFAULT_COLOR: &str = "#334155";
const WAVEFORM_BUCKETS: usize = 32;

#[tauri::command]
pub async fn analyze_media(path: String, sensitivity: f64) -> Result<AnalysisPayload, String> {
    let probe = probe_media(&path)?;
    let mut warnings = Vec::new();

    let scenes = match detect_scenes(path.clone(), sensitivity).await {
        Ok(scenes) if !scenes.is_empty() => scenes,
        Ok(_) if probe.has_video => fallback_scenes(&path, probe.duration).await,
        Ok(_) => Vec::new(),
        Err(error) => {
            warnings.push(format!("Scene detection fallback: {}", summarize_error(&error)));
            if probe.has_video {
                fallback_scenes(&path, probe.duration).await
            } else {
                Vec::new()
            }
        }
    };

    let waveform = match analyze_audio_waveform(&path) {
        Ok(waveform) => waveform,
        Err(error) => {
            if probe.has_audio {
                warnings.push(format!("Audio waveform fallback: {}", summarize_error(&error)));
            }
            silence_waveform()
        }
    };

    let transcript = match transcribe_if_available(&path, "tiny") {
        Ok(Some(transcript)) => transcript,
        Ok(None) => {
            if probe.has_audio {
                warnings.push(
                    "Transcript unavailable. Install `whisper-cli` and add a local tiny/base model under ~/.frame/models/whisper/."
                        .to_string(),
                );
            }
            empty_transcript()
        }
        Err(error) => {
            warnings.push(format!("Transcript unavailable: {}", summarize_error(&error)));
            empty_transcript()
        }
    };

    let palette = derive_palette(&scenes);
    let mood = derive_mood(&palette, &transcript, probe.has_audio);
    let tags = derive_tags(&mood, scenes.len(), probe.has_audio, !transcript.segments.is_empty());
    let thumbnail_color = scenes
        .first()
        .map(|scene| scene.thumbnail_color.clone())
        .or_else(|| palette.first().cloned())
        .unwrap_or_else(|| DEFAULT_COLOR.to_string());

    Ok(AnalysisPayload {
        analysis: AnalysisResult {
            scenes,
            palette,
            mood,
            transcript: transcript.segments,
            language: format_language(&transcript.language),
            audio_waveform: waveform,
            processed_at: iso_timestamp(),
            warnings,
        },
        thumbnail_color,
        tags,
    })
}

async fn fallback_scenes(path: &str, duration: f64) -> Vec<Scene> {
    let end_time = if duration > 0.0 { duration } else { 1.0 };
    let midpoint = end_time / 2.0;
    let thumbnail_path = crate::commands::files::extract_thumbnail(path.to_string(), midpoint)
        .await
        .ok()
        .map(|thumbnail| thumbnail.path);

    vec![Scene {
        index: 1,
        start_time: 0.0,
        end_time,
        confidence: 58.0,
        thumbnail_color: DEFAULT_COLOR.to_string(),
        thumbnail_path,
    }]
}

fn analyze_audio_waveform(path: &str) -> Result<Vec<u8>, String> {
    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            path,
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "2000",
            "-f",
            "s16le",
            "-",
        ])
        .output()
        .map_err(|error| format!("waveform extraction failed to start: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("waveform extraction failed: {}", stderr.trim()));
    }

    let samples = output.stdout;
    if samples.len() < 2 {
        return Ok(silence_waveform());
    }

    let amplitudes: Vec<f64> = samples
        .chunks_exact(2)
        .map(|chunk| {
            let value = i16::from_le_bytes([chunk[0], chunk[1]]) as i32;
            (value.abs() as f64 / i16::MAX as f64).min(1.0)
        })
        .collect();

    if amplitudes.is_empty() {
        return Ok(silence_waveform());
    }

    let chunk_size = ((amplitudes.len() as f64) / WAVEFORM_BUCKETS as f64).ceil() as usize;
    let bucket_size = chunk_size.max(1);

    Ok((0..WAVEFORM_BUCKETS)
        .map(|index| {
            let start = index * bucket_size;
            let end = ((index + 1) * bucket_size).min(amplitudes.len());

            if start >= end {
                return 8;
            }

            let peak = amplitudes[start..end]
                .iter()
                .copied()
                .fold(0.0, f64::max);

            ((peak * 100.0).round() as i32).clamp(8, 100) as u8
        })
        .collect())
}

fn derive_palette(scenes: &[Scene]) -> Vec<String> {
    let mut palette = Vec::new();

    for color in scenes.iter().map(|scene| scene.thumbnail_color.as_str()) {
        if !palette.iter().any(|entry| entry == color) {
            palette.push(color.to_string());
        }

        if palette.len() == 6 {
            break;
        }
    }

    if palette.is_empty() {
        palette.push(DEFAULT_COLOR.to_string());
    }

    palette
}

fn derive_mood(palette: &[String], transcript: &Transcript, has_audio: bool) -> Vec<String> {
    let (brightness, warmth) = average_palette_metrics(palette);
    let mut mood = Vec::new();

    mood.push(if brightness >= 0.52 {
        "bright"
    } else {
        "low-light"
    }
    .to_string());
    mood.push(if warmth >= 0.52 { "warm" } else { "cool" }.to_string());

    if !transcript.segments.is_empty() {
        mood.push("dialogue-led".to_string());
    } else if has_audio {
        mood.push("audio-present".to_string());
    } else {
        mood.push("visual-only".to_string());
    }

    mood
}

fn derive_tags(
    mood: &[String],
    scene_count: usize,
    has_audio: bool,
    has_transcript: bool,
) -> Vec<String> {
    let mut tags = mood.iter().take(2).cloned().collect::<Vec<_>>();
    tags.push(if scene_count > 1 {
        "multi-scene"
    } else {
        "single-take"
    }
    .to_string());
    tags.push(if has_audio { "audio" } else { "silent" }.to_string());

    if has_transcript {
        tags.push("transcribed".to_string());
    }

    tags
}

fn average_palette_metrics(palette: &[String]) -> (f64, f64) {
    let mut brightness_total = 0.0;
    let mut warmth_total = 0.0;
    let mut count = 0.0;

    for color in palette {
        if let Some((red, green, blue)) = parse_hex_color(color) {
            brightness_total += (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
            warmth_total += red / (red + blue + 0.001);
            count += 1.0;
        }
    }

    if count == 0.0 {
        return (0.0, 0.5);
    }

    (brightness_total / count, warmth_total / count)
}

fn parse_hex_color(color: &str) -> Option<(f64, f64, f64)> {
    let value = color.strip_prefix('#')?;
    if value.len() != 6 {
        return None;
    }

    let red = u8::from_str_radix(&value[0..2], 16).ok()? as f64 / 255.0;
    let green = u8::from_str_radix(&value[2..4], 16).ok()? as f64 / 255.0;
    let blue = u8::from_str_radix(&value[4..6], 16).ok()? as f64 / 255.0;

    Some((red, green, blue))
}

fn empty_transcript() -> Transcript {
    Transcript {
        language: "unknown".to_string(),
        segments: Vec::new(),
    }
}

fn silence_waveform() -> Vec<u8> {
    vec![8; WAVEFORM_BUCKETS]
}

fn format_language(language: &str) -> String {
    match language.trim() {
        "" | "unknown" => "Unknown".to_string(),
        value if value.len() <= 5 => value.to_uppercase(),
        value => value.to_string(),
    }
}

fn summarize_error(error: &str) -> String {
    error.lines().next().unwrap_or(error).trim().to_string()
}

fn iso_timestamp() -> String {
    let output = Command::new("date")
        .args(["-u", "+%Y-%m-%dT%H:%M:%SZ"])
        .output();

    match output {
        Ok(result) if result.status.success() => {
            String::from_utf8_lossy(&result.stdout).trim().to_string()
        }
        _ => "1970-01-01T00:00:00Z".to_string(),
    }
}
