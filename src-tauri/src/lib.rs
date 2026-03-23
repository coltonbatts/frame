mod commands;
mod models;

use tauri_plugin_dialog::DialogExt;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::files::open_file_dialog,
            commands::files::get_file_metadata,
            commands::files::extract_frame,
            commands::files::probe_file,
            commands::files::read_video_file,
            commands::files::extract_thumbnail,
            commands::files::show_in_finder,
            commands::ffmpeg::run_ffmpeg,
            commands::scenes::detect_scenes,
            commands::whisper::transcribe,
            commands::queue::add_to_queue,
            commands::queue::process_queue,
            commands::queue::cancel_item
        ])
        .run(tauri::generate_context!())
        .expect("error while running Frame");
}
