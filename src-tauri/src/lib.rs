mod commands;
mod models;
mod plugins;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(plugins::shot_list::init())
        .invoke_handler(tauri::generate_handler![
            commands::analysis::analyze_media,
            commands::files::open_file_dialog,
            commands::files::get_file_metadata,
            commands::files::extract_frame,
            commands::files::capture_hd_frame,
            commands::files::build_manual_capture_sheet_row,
            commands::files::load_manual_capture_log,
            commands::files::probe_file,
            commands::files::read_video_file,
            commands::files::extract_thumbnail,
            commands::files::show_in_finder,
            commands::provenance::analyze_provenance,
            commands::provenance::delete_provenance_shot,
            commands::provenance::load_provenance,
            commands::provenance::update_provenance_shot,
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
