use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub codec: String,
    pub fps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub codec: String,
    pub fps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub timestamp: f64,
    pub preview_color: String,
}

/// A thumbnail extracted from a video at a specific timestamp.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbnail {
    /// Absolute path to the thumbnail JPEG file.
    pub path: String,
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Timestamp in seconds where the frame was extracted.
    pub timestamp: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureHdFrameRequest {
    pub video_path: String,
    pub time: f64,
    pub output_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedFrame {
    pub output_path: String,
    pub output_dir: String,
    pub file_name: String,
    pub timestamp: f64,
    pub timecode: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub index: usize,
    pub start_time: f64,
    pub end_time: f64,
    pub confidence: f64,
    pub thumbnail_color: String,
    pub thumbnail_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotRecord {
    pub id: String,
    pub video_name: String,
    pub start_time_sec: f64,
    pub end_time_sec: f64,
    pub start_timecode: Option<String>,
    pub end_timecode: Option<String>,
    pub thumbnail_path: Option<String>,
    pub thumbnail_frame_sec: Option<f64>,
    pub description: Option<String>,
    pub source_type: Option<String>,
    pub source_name: Option<String>,
    pub source_reference: Option<String>,
    pub notes: Option<String>,
    pub detection_confidence: f64,
    pub review_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceState {
    pub video_path: String,
    pub video_name: String,
    pub video_duration_sec: f64,
    pub analyzed_at: String,
    pub scene_threshold: f64,
    pub output_dir: String,
    pub thumbnail_dir: String,
    pub sidecar_path: String,
    pub csv_path: String,
    pub shots: Vec<ShotRecord>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeProvenanceRequest {
    pub path: String,
    pub sensitivity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProvenanceShotRequest {
    pub video_path: String,
    pub shot: ShotRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProvenanceShotRequest {
    pub video_path: String,
    pub shot_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub id: String,
    pub start_time: f64,
    pub end_time: f64,
    pub speaker: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub language: String,
    pub segments: Vec<TranscriptSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResult {
    pub scenes: Vec<Scene>,
    pub palette: Vec<String>,
    pub mood: Vec<String>,
    pub transcript: Vec<TranscriptSegment>,
    pub language: String,
    pub audio_waveform: Vec<u8>,
    pub processed_at: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisPayload {
    pub analysis: AnalysisResult,
    pub thumbnail_color: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreset {
    pub id: String,
    pub name: String,
    pub container: String,
    pub video_codec: String,
    pub audio_codec: String,
    pub bitrate: Option<String>,
    pub resolution: Option<String>,
    pub fps: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportJob {
    pub queue_id: String,
    pub input_path: String,
    pub output_path: String,
    pub duration: f64,
    pub preset: ExportPreset,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: String,
    pub file_id: String,
    pub preset: ExportPreset,
    pub progress: f64,
    pub state: String,
    pub output_path: Option<String>,
    pub error: Option<String>,
}
