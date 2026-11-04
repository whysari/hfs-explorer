pub mod btree;
pub mod drives;
pub mod generator;
pub mod reader;
pub mod types;

pub use reader::HfsReader;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_generate_and_read_hfs_volume() {
        let temp_path = std::env::temp_dir().join("test_hfs_unit.img");
        let _ = fs::remove_file(&temp_path);

        generator::generate_test_image(&temp_path).expect("Failed to generate test image");

        let mut reader = HfsReader::open(&temp_path, Some(0)).expect("Failed to open HFS+ volume");
        let info = reader.get_volume_info();
        assert_eq!(info.name, "Macintosh HD");
        assert_eq!(info.file_count, 3);
        assert_eq!(info.folder_count, 2);

        let root_entries = reader.list_directory(types::ROOT_FOLDER_ID);
        assert!(root_entries.iter().any(|e| e.name == "Documents"));
        assert!(root_entries.iter().any(|e| e.name == "Pictures"));
        assert!(root_entries.iter().any(|e| e.name == "hello_apple.txt"));

        // Test single file extraction
        let hello_entry = root_entries
            .iter()
            .find(|e| e.name == "hello_apple.txt")
            .unwrap();
        let extracted_path = std::env::temp_dir().join("hello_extracted.txt");
        let written = reader
            .extract_file(hello_entry.id, &extracted_path)
            .expect("Failed to extract file");
        assert!(written > 0);

        let extracted_content = fs::read_to_string(&extracted_path).unwrap();
        assert!(extracted_content.contains("Welcome to Apple HFS+ on Windows!"));

        // Test recursive folder extraction (Documents folder contains notes.txt)
        let doc_entry = root_entries
            .iter()
            .find(|e| e.name == "Documents")
            .unwrap();
        let extract_dir = std::env::temp_dir().join("hfs_extracted_docs");
        let _ = fs::remove_dir_all(&extract_dir);

        let stats = reader
            .extract_entry(doc_entry.id, &extract_dir)
            .expect("Failed to extract folder");
        assert_eq!(stats.files_count, 1);
        assert!(stats.bytes_written > 0);

        let notes_file = extract_dir.join("notes.txt");
        assert!(notes_file.exists());
        let notes_content = fs::read_to_string(&notes_file).unwrap();
        assert!(notes_content.contains("HFS+ Project Notes"));

        let _ = fs::remove_file(&temp_path);
        let _ = fs::remove_file(&extracted_path);
        let _ = fs::remove_dir_all(&extract_dir);
    }
}
