use crate::models::Scene;

fn seed_from_path(path: &str) -> usize {
    path.bytes()
        .enumerate()
        .fold(0_usize, |acc, (index, byte)| acc + (byte as usize) * (index + 7))
}

#[tauri::command]
pub async fn detect_scenes(path: String, sensitivity: f64) -> Result<Vec<Scene>, String> {
    let seed = seed_from_path(&path);
    let duration = 180.0 + (seed % 360) as f64;
    let count = (duration / (22.0 + (100.0 - sensitivity.max(1.0)) / 5.0))
        .round()
        .clamp(4.0, 10.0) as usize;
    let spacing = duration / count as f64;
    let colors = ["#818CF8", "#22C55E", "#F97316", "#FB7185"];

    Ok((0..count)
        .map(|index| Scene {
            index: index + 1,
            start_time: spacing * index as f64,
            end_time: (spacing * (index + 1) as f64).min(duration),
            confidence: 74.0 + ((seed + index * 19) % 21) as f64,
            thumbnail_color: colors[(seed + index) % colors.len()].to_string(),
        })
        .collect())
}
