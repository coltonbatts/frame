use tauri::AppHandle;

use crate::commands::ffmpeg::run_ffmpeg;
use crate::models::{ExportJob, QueueItem};

#[tauri::command]
pub async fn add_to_queue(item: QueueItem) -> Result<String, String> {
    Ok(item.id)
}

#[tauri::command]
pub async fn process_queue(app: AppHandle, job: ExportJob) -> Result<String, String> {
    run_ffmpeg(app, job).await
}

#[tauri::command]
pub async fn cancel_item(_id: String) -> Result<(), String> {
    Ok(())
}
