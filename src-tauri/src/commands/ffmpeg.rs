use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use tauri::{AppHandle, Emitter};

use crate::commands::files::probe_media;
use crate::models::{ExportJob, ExportPreset};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportProgressEvent {
    queue_id: String,
    progress: f64,
}

#[tauri::command]
pub async fn run_ffmpeg(app: AppHandle, job: ExportJob) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_ffmpeg_blocking(app, job))
        .await
        .map_err(|error| format!("ffmpeg worker failed to join: {}", error))?
}

fn run_ffmpeg_blocking(app: AppHandle, job: ExportJob) -> Result<String, String> {
    let probe = probe_media(&job.input_path)?;
    let total_duration = if job.duration > 0.0 {
        job.duration
    } else {
        probe.duration
    };

    let output_path = PathBuf::from(&job.output_path);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create export directory: {}", error))?;
    }

    let mut command = Command::new("ffmpeg");
    command.args([
        "-hide_banner",
        "-y",
        "-loglevel",
        "error",
        "-nostats",
        "-progress",
        "pipe:1",
        "-i",
        &job.input_path,
    ]);

    if probe.has_video {
        apply_video_options(&mut command, &job.preset);
        if let Some(filter) = build_video_filter(&job.preset) {
            command.args(["-vf", &filter]);
        }
        command.args(["-map", "0:v:0?"]);
    } else {
        command.arg("-vn");
    }

    if probe.has_audio {
        apply_audio_options(&mut command, &job.preset);
        command.args(["-map", "0:a:0?"]);
    } else {
        command.arg("-an");
    }

    if supports_faststart(&job.preset.container) {
        command.args(["-movflags", "+faststart"]);
    }

    command.arg(&job.output_path);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.stdin(Stdio::null());

    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to start ffmpeg: {}", error))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture ffmpeg progress output".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture ffmpeg error output".to_string())?;

    let stderr_handle = std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut output = String::new();
        let _ = reader.read_to_string(&mut output);
        output
    });

    let mut progress_reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut latest_progress = 0.0_f64;

    loop {
        line.clear();
        let bytes_read = progress_reader
            .read_line(&mut line)
            .map_err(|error| format!("failed to read ffmpeg progress: {}", error))?;

        if bytes_read == 0 {
            break;
        }

        let trimmed = line.trim();
        if let Some(seconds) = parse_progress_time(trimmed) {
            if total_duration > 0.0 {
                let progress = ((seconds / total_duration) * 100.0).clamp(0.0, 99.9);
                if progress > latest_progress + 0.25 {
                    latest_progress = progress;
                    app.emit(
                        "export:progress",
                        ExportProgressEvent {
                            queue_id: job.queue_id.clone(),
                            progress,
                        },
                    )
                    .map_err(|error| format!("failed to emit export progress: {}", error))?;
                }
            }
        } else if trimmed == "progress=end" {
            latest_progress = 100.0;
            app.emit(
                "export:progress",
                ExportProgressEvent {
                    queue_id: job.queue_id.clone(),
                    progress: 100.0,
                },
            )
            .map_err(|error| format!("failed to emit export progress: {}", error))?;
            break;
        }
    }

    let status = child
        .wait()
        .map_err(|error| format!("failed to wait for ffmpeg: {}", error))?;
    let stderr_output = stderr_handle.join().unwrap_or_default();

    if !status.success() {
        let stderr_text = stderr_output.trim();
        return Err(if stderr_text.is_empty() {
            "ffmpeg export failed".to_string()
        } else {
            format!("ffmpeg export failed: {}", stderr_text)
        });
    }

    if latest_progress < 100.0 {
        app.emit(
            "export:progress",
            ExportProgressEvent {
                queue_id: job.queue_id,
                progress: 100.0,
            },
        )
        .map_err(|error| format!("failed to emit export progress: {}", error))?;
    }

    Ok(job.output_path)
}

fn apply_video_options(command: &mut Command, preset: &ExportPreset) {
    match preset.video_codec.as_str() {
        "h264" => {
            command.args(["-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p"]);
            if let Some(bitrate) = preset.bitrate.as_deref() {
                command.args(["-b:v", bitrate]);
            } else {
                command.args(["-crf", "20"]);
            }
        }
        "h265" => {
            command.args(["-c:v", "libx265", "-preset", "medium", "-pix_fmt", "yuv420p"]);
            if let Some(bitrate) = preset.bitrate.as_deref() {
                command.args(["-b:v", bitrate]);
            } else {
                command.args(["-crf", "22"]);
            }
        }
        "vp9" => {
            command.args(["-c:v", "libvpx-vp9"]);
            if let Some(bitrate) = preset.bitrate.as_deref() {
                command.args(["-b:v", bitrate]);
            } else {
                command.args(["-crf", "32"]);
            }
        }
        "prores" => {
            command.args(["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"]);
        }
        _ => {
            command.args(["-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p"]);
            if let Some(bitrate) = preset.bitrate.as_deref() {
                command.args(["-b:v", bitrate]);
            }
        }
    }
}

fn apply_audio_options(command: &mut Command, preset: &ExportPreset) {
    match preset.audio_codec.as_str() {
        "aac" => command.args(["-c:a", "aac"]),
        "opus" => command.args(["-c:a", "libopus"]),
        "pcm" => command.args(["-c:a", "pcm_s16le"]),
        _ => command.args(["-c:a", "aac"]),
    };
}

fn build_video_filter(preset: &ExportPreset) -> Option<String> {
    let mut filters = Vec::new();

    if let Some(resolution) = preset.resolution.as_deref() {
        let scale = resolution.replace('x', ":");
        filters.push(format!("scale={}", scale));
    }

    if let Some(fps) = preset.fps {
        filters.push(format!("fps={}", trim_float(fps)));
    }

    if filters.is_empty() {
        None
    } else {
        Some(filters.join(","))
    }
}

fn supports_faststart(container: &str) -> bool {
    matches!(container, "mp4" | "mov")
}

fn parse_progress_time(line: &str) -> Option<f64> {
    if let Some(value) = line.strip_prefix("out_time=") {
        return parse_timestamp(value);
    }

    if let Some(value) = line.strip_prefix("out_time_ms=") {
        return value.parse::<f64>().ok().map(|entry| entry / 1_000_000.0);
    }

    if let Some(value) = line.strip_prefix("out_time_us=") {
        return value.parse::<f64>().ok().map(|entry| entry / 1_000_000.0);
    }

    None
}

fn parse_timestamp(value: &str) -> Option<f64> {
    let parts: Vec<&str> = value.split(':').collect();
    match parts.as_slice() {
        [hours, minutes, seconds] => Some(
            hours.parse::<f64>().ok()? * 3600.0
                + minutes.parse::<f64>().ok()? * 60.0
                + seconds.parse::<f64>().ok()?,
        ),
        [minutes, seconds] => {
            Some(minutes.parse::<f64>().ok()? * 60.0 + seconds.parse::<f64>().ok()?)
        }
        _ => value.parse::<f64>().ok(),
    }
}

fn trim_float(value: f64) -> String {
    let integer = value.trunc();
    if (value - integer).abs() < f64::EPSILON {
        format!("{}", integer as i64)
    } else {
        let mut formatted = format!("{:.3}", value);
        while formatted.contains('.') && formatted.ends_with('0') {
            formatted.pop();
        }
        if formatted.ends_with('.') {
            formatted.pop();
        }
        formatted
    }
}
