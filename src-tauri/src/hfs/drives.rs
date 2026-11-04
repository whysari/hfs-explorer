use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedDrive {
    pub id: String,
    pub name: String,
    pub path: String,
    pub drive_type: String,
    pub is_removable: bool,
}

/// Enumerate available Windows drives (removable USBs and physical drives)
pub fn enumerate_drives() -> Vec<DetectedDrive> {
    let mut drives = Vec::new();

    // Check drive letters A: through Z:
    for letter in b'A'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        let path = Path::new(&root);
        if path.exists() {
            // Test if removable or accessible
            let device_path = format!("\\\\.\\{}:", letter as char);
            let is_removable = (letter as char) == 'E' || (letter as char) == 'F' || (letter as char) == 'G';

            drives.push(DetectedDrive {
                id: format!("{}:", letter as char),
                name: if is_removable {
                    format!("Removable USB Drive ({}:)", letter as char)
                } else {
                    format!("Local Disk ({}:)", letter as char)
                },
                path: device_path,
                drive_type: if is_removable { "Removable" } else { "Fixed" }.to_string(),
                is_removable,
            });
        }
    }

    // Also check PhysicalDrive 0 through 8
    for i in 0..8 {
        let phys_path = format!("\\\\.\\PhysicalDrive{}", i);
        // Try opening to see if it exists (read-only)
        if let Ok(_) = File::open(&phys_path) {
            drives.push(DetectedDrive {
                id: format!("PhysicalDrive{}", i),
                name: format!("Physical Drive {}", i),
                path: phys_path,
                drive_type: "PhysicalDisk".to_string(),
                is_removable: i > 0,
            });
        }
    }

    drives
}
