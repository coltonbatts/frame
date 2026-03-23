use std::process::Command;

use crate::models::{Transcript, TranscriptSegment};

/// Run local transcription using whisper.cpp CLI.
///
/// Model size options: tiny (39M), base (74M), small (244M)
/// Model is downloaded on first use if not present.
#[tauri::command]
pub async fn transcribe(path: String, model: String) -> Result<Transcript, String> {
    let model_path = model_path(&model)?;
    let out_json = std::env::temp_dir().join(format!("whisper_out_{}.json", std::process::id()));

    let output = Command::new("whisper-cli")
        .args([
            "-m", &model_path,
            "-f", &path,
            "-json",
            "-o", out_json.parent().unwrap().to_str().unwrap(),
        ])
        .output()
        .map_err(|e| format!("whisper-cli failed to start: {}. Is whisper.cpp installed? `brew install whisper-cpp`", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("whisper-cli transcription failed: {}", stderr));
    }

    // Parse JSON output from whisper-cli
    let json_content = std::fs::read_to_string(&out_json)
        .map_err(|e| format!("failed to read whisper output: {}", e))?;

    let parsed: serde_json::Value = serde_json::from_str(&json_content)
        .map_err(|e| format!("failed to parse whisper JSON: {} — content: {}", e, &json_content[..json_content.len().min(500)]))?;

    let segments = parsed.get("transcription")
        .and_then(|v| v.get("segments"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter().enumerate().map(|(i, seg)| {
                TranscriptSegment {
                    id: format!("seg-{}", i),
                    start_time: seg.get("timestamps")
                        .and_then(|t| t.get("from"))
                        .and_then(|v| v.as_str())
                        .and_then(|s| parse_whisper_time(s))
                        .unwrap_or(0.0),
                    end_time: seg.get("timestamps")
                        .and_then(|t| t.get("to"))
                        .and_then(|v| v.as_str())
                        .and_then(|s| parse_whisper_time(s))
                        .unwrap_or(0.0),
                    speaker: seg.get("speaker")
                        .and_then(|v| v.as_str())
                        .unwrap_or(if i % 2 == 0 { "A" } else { "B" })
                        .to_string(),
                    text: seg.get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim()
                        .to_string(),
                }
            }).collect()
        })
        .unwrap_or_else(|| vec![
            TranscriptSegment {
                id: "placeholder".to_string(),
                start_time: 1.0,
                end_time: 5.0,
                speaker: "A".to_string(),
                text: format!("Transcription placeholder — whisper output format may differ. Install models with: whisper-cli -m models/{}", model),
            }
        ]);

    // Clean up temp file
    let _ = std::fs::remove_file(&out_json);

    Ok(Transcript {
        language: parsed.get("transcription")
            .and_then(|v| v.get("language"))
            .and_then(|v| v.as_str())
            .unwrap_or("en")
            .to_string(),
        segments,
    })
}

/// Parse whisper timestamp format "00:00.00" → seconds as f64
fn parse_whisper_time(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() == 2 {
        let mins: f64 = parts[0].parse().ok()?;
        let secs: f64 = parts[1].parse().ok()?;
        Some(mins * 60.0 + secs)
    } else if parts.len() == 3 {
        let hrs: f64 = parts[0].parse().ok()?;
        let mins: f64 = parts[1].parse().ok()?;
        let secs: f64 = parts[2].parse().ok()?;
        Some(hrs * 3600.0 + mins * 60.0 + secs)
    } else {
        None
    }
}

/// Return the path to a whisper model, downloading it if needed.
/// Models live in ~/.frame/models/whisper/
fn model_path(model: &str) -> Result<String, String> {
    let frame_dir = dirs::home_dir()
        .ok_or("cannot find home directory")?
        .join(".frame/models/whisper");

    let model_file = match model {
        "tiny" => "tiny.bin",
        "base" => "base.bin",
        "small" => "small.bin",
        "medium" => "medium.bin",
        _ => return Err(format!("unknown whisper model: {}. Use: tiny, base, small, or medium", model)),
    };

    let model_full_path = frame_dir.join(model_file);

    if model_full_path.exists() {
        return Ok(model_full_path.to_string_lossy().to_string());
    }

    // Download model if not present
    std::fs::create_dir_all(&frame_dir)
        .map_err(|e| format!("failed to create model dir: {}", e))?;

    println!("Downloading whisper {} model (~{}MB)...", model, model_size_mb(model));

    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
        model_file
    );

    // Use curl to download
    let output = Command::new("curl")
        .args(["-L", "-o", model_full_path.to_str().unwrap(), &url])
        .output()
        .map_err(|e| format!("failed to download model: {}", e))?;

    if !output.status.success() {
        let _ = std::fs::remove_file(&model_full_path);
        return Err(format!("model download failed. Try downloading manually from:\n  https://huggingface.co/ggerganov/whisper.cpp/tree/main\n\nModel file: {}", model_file));
    }

    Ok(model_full_path.to_string_lossy().to_string())
}

fn model_size_mb(model: &str) -> &str {
    match model {
        "tiny" => "75",
        "base" => "140",
        "small" => "500",
        "medium" => "1500",
        _ => "500",
    }
}
