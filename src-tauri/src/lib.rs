use std::path::Path;
use std::sync::Mutex;
use tauri::State;

mod hfs;
use hfs::drives::{enumerate_drives, DetectedDrive};
use hfs::types::{ExtractionStats, HfsEntry, VolumeInfo, ROOT_FOLDER_ID};
use hfs::HfsReader;

pub struct AppState {
    pub reader: Mutex<Option<HfsReader>>,
}

#[tauri::command]
fn list_drives() -> Vec<DetectedDrive> {
    enumerate_drives()
}

#[tauri::command]
fn open_volume(
    state: State<AppState>,
    source_path: String,
    partition_offset: Option<u64>,
) -> Result<VolumeInfo, String> {
    let reader = HfsReader::open(&source_path, partition_offset)
        .map_err(|e| format!("Failed to open HFS+ volume: {}", e))?;

    let info = reader.get_volume_info();

    let mut lock = state.reader.lock().map_err(|e| e.to_string())?;
    *lock = Some(reader);

    Ok(info)
}

#[tauri::command]
fn list_directory(state: State<AppState>, folder_id: Option<u32>) -> Result<Vec<HfsEntry>, String> {
    let lock = state.reader.lock().map_err(|e| e.to_string())?;
    let reader = lock.as_ref().ok_or("No volume is currently open")?;

    let target_id = folder_id.unwrap_or(ROOT_FOLDER_ID);
    Ok(reader.list_directory(target_id))
}

#[tauri::command]
fn extract_file(
    state: State<AppState>,
    file_id: u32,
    target_path: String,
) -> Result<u64, String> {
    let mut lock = state.reader.lock().map_err(|e| e.to_string())?;
    let reader = lock.as_mut().ok_or("No volume is currently open")?;

    reader
        .extract_file(file_id, &target_path)
        .map_err(|e| format!("Extraction failed: {}", e))
}

#[tauri::command]
fn extract_entry(
    state: State<AppState>,
    entry_id: u32,
    destination_path: String,
) -> Result<ExtractionStats, String> {
    let mut lock = state.reader.lock().map_err(|e| e.to_string())?;
    let reader = lock.as_mut().ok_or("No volume is currently open")?;

    let dest_path = Path::new(&destination_path);
    reader
        .extract_entry(entry_id, dest_path)
        .map_err(|e| format!("Extraction failed: {}", e))
}

#[tauri::command]
fn prepare_drag_entry(
    state: State<AppState>,
    entry_id: u32,
) -> Result<String, String> {
    let mut lock = state.reader.lock().map_err(|e| e.to_string())?;
    let reader = lock.as_mut().ok_or("No volume is currently open")?;

    let temp_cache = std::env::temp_dir().join("hfs_explorer_drag_cache");
    let _ = std::fs::create_dir_all(&temp_cache);

    let stats = reader
        .extract_entry(entry_id, &temp_cache)
        .map_err(|e| format!("Failed to prepare file for drag: {}", e))?;

    Ok(stats.destination_path)
}

#[tauri::command]
async fn start_drag_out(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: State<'_, AppState>,
    entry_id: u32,
) -> Result<(), String> {
    let mut lock = state.reader.lock().map_err(|e| e.to_string())?;
    let reader = lock.as_mut().ok_or("No volume is currently open")?;

    let temp_cache = std::env::temp_dir().join("hfs_explorer_drag_cache");
    let _ = std::fs::create_dir_all(&temp_cache);

    let stats = reader
        .extract_entry(entry_id, &temp_cache)
        .map_err(|e| format!("Failed to prepare file for drag: {}", e))?;

    let file_path = std::path::PathBuf::from(&stats.destination_path);

    app.run_on_main_thread(move || {
        let _ = drag::start_drag(
            &window,
            drag::DragItem::Files(vec![file_path]),
            drag::Image::Raw(vec![]),
            |_result, _pos| {},
            drag::Options::default(),
        );
    })
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn create_test_image(dest_path: String) -> Result<String, String> {
    hfs::generator::generate_test_image(&dest_path)
        .map_err(|e| format!("Failed to generate test image: {}", e))?;
    Ok(dest_path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .manage(AppState {
            reader: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            list_drives,
            open_volume,
            list_directory,
            extract_file,
            extract_entry,
            prepare_drag_entry,
            start_drag_out,
            create_test_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
