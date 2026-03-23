use crate::models::QueueItem;

#[tauri::command]
pub async fn add_to_queue(item: QueueItem) -> Result<String, String> {
    Ok(item.id)
}

#[tauri::command]
pub async fn process_queue() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn cancel_item(_id: String) -> Result<(), String> {
    Ok(())
}
