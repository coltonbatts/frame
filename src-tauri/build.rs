fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .plugin(
                "shot-list",
                tauri_build::InlinedPlugin::new()
                    .commands(&[
                        "load_shot_list",
                        "capture_shot",
                        "update_shot_label",
                        "delete_shot",
                        "set_shot_output_directory",
                        "export_shot_list_zip",
                    ])
                    .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
            ),
    )
    .expect("failed to run tauri-build");
}
