use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::models::{
    CaptureHdFrameRequest, CapturedFrame, FileMetadata, Frame, MediaInfo, Thumbnail,
};

pub(crate) struct MediaProbe {
    pub duration: f64,
    pub size: u64,
    pub width: u32,
    pub height: u32,
    pub codec: String,
    pub fps: f64,
    pub has_video: bool,
    pub has_audio: bool,
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or(path)
        .to_string()
}

/// Probe a video file with ffprobe and return real metadata.
#[tauri::command]
pub async fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let probe = probe_media(&path)?;

    Ok(FileMetadata {
        path: path.clone(),
        name: file_name(&path),
        size: probe.size,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        codec: probe.codec,
        fps: probe.fps,
    })
}

pub(crate) fn probe_media(path: &str) -> Result<MediaProbe, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            path,
        ])
        .output()
        .map_err(|e| format!("failed to run ffprobe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    let json: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("failed to parse ffprobe output: {}", e))?;

    let format = json
        .get("format")
        .ok_or("no format section in ffprobe output")?;
    let streams = json
        .get("streams")
        .and_then(|v| v.as_array())
        .ok_or("no streams in ffprobe output")?;

    let video_stream = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(|v| v.as_str()) == Some("video"));
    let audio_stream = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(|v| v.as_str()) == Some("audio"));
    let primary_stream = video_stream
        .or(audio_stream)
        .ok_or("no audio or video stream found")?;

    let duration = format
        .get("duration")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    let size = format
        .get("size")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    let width = video_stream
        .and_then(|stream| stream.get("width"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    let height = video_stream
        .and_then(|stream| stream.get("height"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    let codec = primary_stream
        .get("codec_name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_uppercase();

    let fps = video_stream
        .and_then(|stream| stream.get("r_frame_rate"))
        .and_then(|v| v.as_str())
        .map(parse_fps)
        .unwrap_or(0.0);

    Ok(MediaProbe {
        duration,
        size,
        width,
        height,
        codec,
        fps,
        has_video: video_stream.is_some(),
        has_audio: audio_stream.is_some(),
    })
}

/// Parse fps from "30000/1001" format to a float like 29.97
fn parse_fps(fps_str: &str) -> f64 {
    let parts: Vec<&str> = fps_str.split('/').collect();
    if parts.len() == 2 {
        let num: f64 = parts[0].parse().unwrap_or(24.0);
        let den: f64 = parts[1].parse().unwrap_or(1.0);
        if den > 0.0 {
            num / den
        } else {
            24.0
        }
    } else {
        fps_str.parse().unwrap_or(24.0)
    }
}

/// Get MediaInfo (subset of FileMetadata)
#[tauri::command]
pub async fn probe_file(path: String) -> Result<MediaInfo, String> {
    let meta = get_file_metadata(path).await?;
    Ok(MediaInfo {
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
        codec: meta.codec,
        fps: meta.fps,
    })
}

/// Extract a video frame as a JPEG to a temp path and return the path.
#[tauri::command]
pub async fn extract_frame(path: String, time: f64) -> Result<Frame, String> {
    let _ext = Path::new(&path)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("mp4");
    let tmp = std::env::temp_dir();
    let out_path = tmp.join(format!("frame_{}.jpg", std::process::id()));

    let output = Command::new("ffmpeg")
        .args([
            "-y",
            "-ss",
            &format!("{:.3}", time),
            "-i",
            &path,
            "-vframes",
            "1",
            "-q:v",
            "2",
            out_path.to_str().unwrap(),
        ])
        .output()
        .map_err(|e| format!("ffmpeg frame extract failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg failed: {}", stderr));
    }

    Ok(Frame {
        timestamp: time,
        preview_color: out_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn capture_hd_frame(request: CaptureHdFrameRequest) -> Result<CapturedFrame, String> {
    tauri::async_runtime::spawn_blocking(move || capture_hd_frame_blocking(request))
        .await
        .map_err(|error| format!("frame capture worker failed to join: {}", error))?
}

/// Open native file dialog and return selected file paths.
#[tauri::command]
pub async fn open_file_dialog() -> Result<Vec<String>, String> {
    // Tauri v2 uses the dialog plugin — this is a placeholder.
    // The actual dialog is opened from the frontend via @tauri-apps/plugin-dialog.
    // This command exists for cases where Rust needs to initiate the dialog.
    Err("use @tauri-apps/plugin-dialog from the frontend".to_string())
}

/// Read a file from disk and return its bytes (for video playback via blob URL).
#[tauri::command]
pub async fn read_video_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("failed to read file {}: {}", path, e))
}

/// Extract a thumbnail JPEG from a video at a given timestamp.
/// Returns the path to the temp JPEG file.
#[tauri::command]
pub async fn extract_thumbnail(path: String, time: f64) -> Result<Thumbnail, String> {
    let meta = probe_media(&path)?;

    if !meta.has_video {
        return Err("thumbnail extraction requires a video stream".to_string());
    }

    let tmp = std::env::temp_dir();
    let id = std::process::id();
    let out_path = tmp.join(format!("thumb_{}_{:.3}.jpg", id, time));

    let output = Command::new("ffmpeg")
        .args([
            "-y",
            "-ss",
            &format!("{:.3}", time),
            "-i",
            &path,
            "-vframes",
            "1",
            "-vf",
            "scale=320:-1",
            "-q:v",
            "3",
            out_path.to_str().unwrap(),
        ])
        .output()
        .map_err(|e| format!("ffmpeg thumbnail failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg failed: {}", stderr));
    }

    Ok(Thumbnail {
        path: out_path.to_string_lossy().to_string(),
        width: meta.width.min(320),
        height: meta.height.saturating_mul(320) / meta.width.max(1),
        timestamp: time,
    })
}

/// Open macOS Finder and reveal the file at the given path.
#[tauri::command]
pub fn show_in_finder(path: String) -> Result<(), String> {
    Command::new("open")
        .args(["-R", &path]) // -R = reveal in Finder
        .output()
        .map_err(|e| format!("open command failed: {}", e))?;

    // Also try using FinderServices for more reliable reveal
    let output = Command::new("osascript")
        .args([
            "-e",
            &format!(
                "tell application \"Finder\" to reveal POSIX file \"{}\"",
                path.replace('"', "\\\"")
            ),
        ])
        .output();

    if let Ok(out) = output {
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            eprintln!("Finder reveal warning: {}", stderr);
        }
    }

    // Activate Finder so the window comes to front
    let _ = Command::new("osascript")
        .args(["-e", "tell application \"Finder\" to activate"])
        .output();

    Ok(())
}

fn capture_hd_frame_blocking(request: CaptureHdFrameRequest) -> Result<CapturedFrame, String> {
    let video_path = PathBuf::from(&request.video_path);
    let probe = probe_media(&request.video_path)?;

    if !probe.has_video {
        return Err("high-definition screenshots require a video stream".to_string());
    }

    let output_dir = resolve_capture_output_dir(&video_path, request.output_dir)?;
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("failed to create screenshot folder: {}", error))?;

    let capture_time = clamp_capture_time(request.time, probe.duration);
    let timecode = format_timecode(capture_time, probe.fps);
    let capture_tag = format_timecode_tag(capture_time, probe.fps);
    let base_name = format!("capture_{}.png", capture_tag);
    let output_path = unique_output_path(&output_dir, &base_name);
    let output_path_str = output_path
        .to_str()
        .ok_or_else(|| "invalid screenshot output path".to_string())?;

    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            &request.video_path,
            "-ss",
            &format!("{:.3}", capture_time),
            "-frames:v",
            "1",
            "-c:v",
            "png",
            output_path_str,
        ])
        .output()
        .map_err(|error| format!("failed to start ffmpeg for screenshot capture: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "ffmpeg screenshot capture failed: {}",
            stderr.trim()
        ));
    }

    let file_name = output_path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("capture.png")
        .to_string();

    Ok(CapturedFrame {
        output_path: output_path.to_string_lossy().into_owned(),
        output_dir: output_dir.to_string_lossy().into_owned(),
        file_name,
        timestamp: capture_time,
        timecode,
        width: probe.width,
        height: probe.height,
    })
}

fn resolve_capture_output_dir(
    video_path: &Path,
    requested_output_dir: Option<String>,
) -> Result<PathBuf, String> {
    if let Some(output_dir) = requested_output_dir {
        let trimmed = output_dir.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    let parent = video_path
        .parent()
        .ok_or_else(|| "the selected video must live on disk".to_string())?;
    Ok(parent.join(format!("{}_screenshots", video_stem(video_path)?)))
}

fn unique_output_path(output_dir: &Path, base_name: &str) -> PathBuf {
    let candidate = output_dir.join(base_name);
    if !candidate.exists() {
        return candidate;
    }

    let stem = Path::new(base_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("capture");
    let extension = Path::new(base_name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("png");

    for index in 2.. {
        let next_candidate = output_dir.join(format!("{}-{}.{}", stem, index, extension));
        if !next_candidate.exists() {
            return next_candidate;
        }
    }

    candidate
}

fn clamp_capture_time(time: f64, duration: f64) -> f64 {
    let safe_time = time.max(0.0);
    if duration > 0.0 {
        safe_time.min((duration - 0.001).max(0.0))
    } else {
        safe_time
    }
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

fn format_timecode_tag(total_seconds: f64, fps: f64) -> String {
    format_timecode(total_seconds, fps).replace(':', "-")
}

fn video_stem(video_path: &Path) -> Result<String, String> {
    video_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "the selected video must have a file name".to_string())
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
            "frame-files-{label}-{}-{timestamp}",
            std::process::id()
        ))
    }

    fn create_test_video(dir: &Path) -> Result<PathBuf, String> {
        let video_path = dir.join("capture-test.mp4");
        let output = Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=320x180:d=1",
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
    fn capture_hd_frame_writes_a_png_at_source_resolution() {
        let temp_dir = unique_temp_dir("capture");
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let video_path = create_test_video(&temp_dir).expect("generate synthetic mp4");

        let result = tauri::async_runtime::block_on(capture_hd_frame(CaptureHdFrameRequest {
            video_path: video_path.to_string_lossy().into_owned(),
            time: 0.5,
            output_dir: None,
        }))
        .expect("capture should succeed");

        assert!(result.output_path.ends_with(".png"));
        assert!(Path::new(&result.output_path).exists());
        assert!(result.output_dir.ends_with("_screenshots"));
        assert_eq!(result.width, 320);
        assert_eq!(result.height, 180);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
