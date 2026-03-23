use std::path::Path;
use std::process::Command;
use serde_json::Value;

use crate::models::{FileMetadata, Frame, MediaInfo, Thumbnail};

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
    let output = Command::new("ffprobe")
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            &path,
        ])
        .output()
        .map_err(|e| format!("failed to run ffprobe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    let json: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("failed to parse ffprobe output: {}", e))?;

    let format = json.get("format")
        .ok_or("no format section in ffprobe output")?;
    let streams = json.get("streams")
        .and_then(|v| v.as_array())
        .ok_or("no streams in ffprobe output")?;

    // Find video stream
    let video_stream = streams.iter()
        .find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("video"))
        .ok_or("no video stream found")?;

    let duration = format.get("duration")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    let size = format.get("size")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    let width = video_stream.get("width")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    let height = video_stream.get("height")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    let codec = video_stream.get("codec_name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_uppercase();

    // FPS as rational (e.g., "30000/1001" for 29.97)
    let fps_str = video_stream.get("r_frame_rate")
        .and_then(|v| v.as_str())
        .unwrap_or("24/1");
    let fps = parse_fps(fps_str);

    Ok(FileMetadata {
        path: path.clone(),
        name: file_name(&path),
        size,
        duration,
        width,
        height,
        codec,
        fps,
    })
}

/// Parse fps from "30000/1001" format to a float like 29.97
fn parse_fps(fps_str: &str) -> f64 {
    let parts: Vec<&str> = fps_str.split('/').collect();
    if parts.len() == 2 {
        let num: f64 = parts[0].parse().unwrap_or(24.0);
        let den: f64 = parts[1].parse().unwrap_or(1.0);
        if den > 0.0 { num / den } else { 24.0 }
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
            "-ss", &format!("{:.3}", time),
            "-i", &path,
            "-vframes", "1",
            "-q:v", "2",
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
    std::fs::read(&path)
        .map_err(|e| format!("failed to read file {}: {}", path, e))
}

/// Extract a thumbnail JPEG from a video at a given timestamp.
/// Returns the path to the temp JPEG file.
#[tauri::command]
pub async fn extract_thumbnail(path: String, time: f64) -> Result<Thumbnail, String> {
    // Get video dimensions first
    let meta = get_file_metadata(path.clone()).await?;

    let tmp = std::env::temp_dir();
    let id = std::process::id();
    let out_path = tmp.join(format!("thumb_{}_{:.3}.jpg", id, time));

    let output = Command::new("ffmpeg")
        .args([
            "-y",
            "-ss", &format!("{:.3}", time),
            "-i", &path,
            "-vframes", "1",
            "-vf", "scale=320:-1",
            "-q:v", "3",
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
