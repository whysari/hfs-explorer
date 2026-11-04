use byteorder::{ByteOrder, LittleEndian};
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use super::btree::CatalogTree;
use super::types::*;

pub struct HfsReader {
    pub file: File,
    pub partition_offset: u64,
    pub volume_header: VolumeHeader,
    pub catalog: CatalogTree,
}

/// Sanitize filename for Windows NTFS compatibility
pub fn sanitize_windows_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if (c as u32) < 32 => '_',
            c => c,
        })
        .collect();

    let trimmed = sanitized.trim().trim_end_matches('.');
    if trimmed.is_empty() {
        "unnamed".to_string()
    } else {
        trimmed.to_string()
    }
}

impl HfsReader {
    /// Detect partition offset and open the HFS+ volume from a file path or device path
    pub fn open<P: AsRef<Path>>(path: P, explicit_offset: Option<u64>) -> io::Result<Self> {
        let mut file = File::open(path)?;

        let partition_offset = match explicit_offset {
            Some(off) => off,
            None => Self::detect_partition_offset(&mut file)?,
        };

        let volume_header = VolumeHeader::read_from(&mut file, partition_offset)?;

        let catalog = CatalogTree::parse(
            &mut file,
            &volume_header.catalog_file,
            &volume_header,
            partition_offset,
        )?;

        Ok(Self {
            file,
            partition_offset,
            volume_header,
            catalog,
        })
    }

    /// Detect if the image/disk has a GPT partition table or is a raw HFS+ partition
    fn detect_partition_offset(file: &mut File) -> io::Result<u64> {
        // First check if offset 0 is already a raw HFS+ volume (header at 1024)
        if let Ok(_) = VolumeHeader::read_from(file, 0) {
            return Ok(0);
        }

        // Check for GPT at LBA 1 (offset 512)
        file.seek(SeekFrom::Start(512))?;
        let mut gpt_header = [0u8; 92];
        if file.read_exact(&mut gpt_header).is_ok() {
            if &gpt_header[0..8] == b"EFI PART" {
                let part_entry_lba = LittleEndian::read_u64(&gpt_header[72..80]);
                let num_part_entries = LittleEndian::read_u32(&gpt_header[80..84]);
                let part_entry_size = LittleEndian::read_u32(&gpt_header[84..88]) as u64;

                // HFS+ partition GUID in mixed endian:
                // 48465300-0000-11AA-AA11-00306543ECAC
                let hfs_guid: [u8; 16] = [
                    0x00, 0x53, 0x46, 0x48, 0x00, 0x00, 0xaa, 0x11, 0xaa, 0x11, 0x00, 0x30, 0x65,
                    0x43, 0xec, 0xac,
                ];

                for i in 0..num_part_entries.min(128) {
                    let entry_offset = (part_entry_lba * 512) + (i as u64 * part_entry_size);
                    file.seek(SeekFrom::Start(entry_offset))?;
                    let mut entry = [0u8; 128];
                    if file.read_exact(&mut entry).is_ok() {
                        let type_guid = &entry[0..16];
                        if type_guid == &hfs_guid {
                            let first_lba = LittleEndian::read_u64(&entry[32..40]);
                            let part_offset = first_lba * 512;
                            // Verify volume header at this offset
                            if let Ok(_) = VolumeHeader::read_from(file, part_offset) {
                                return Ok(part_offset);
                            }
                        }
                    }
                }
            }
        }

        // Check Apple Partition Map (APM) - sector 1 (offset 512) signature 0x504D ("PM")
        file.seek(SeekFrom::Start(512))?;
        let mut apm_sig = [0u8; 2];
        if file.read_exact(&mut apm_sig).is_ok() && &apm_sig == b"PM" {
            // Traverse APM entries (each is 512 bytes)
            for i in 1..16 {
                let entry_offset = i as u64 * 512;
                file.seek(SeekFrom::Start(entry_offset))?;
                let mut apm_entry = [0u8; 512];
                if file.read_exact(&mut apm_entry).is_ok() {
                    if &apm_entry[0..2] == b"PM" {
                        let part_type = &apm_entry[48..80];
                        if part_type.starts_with(b"Apple_HFS") {
                            let start_sector = byteorder::BigEndian::read_u32(&apm_entry[8..12]) as u64;
                            let part_offset = start_sector * 512;
                            if let Ok(_) = VolumeHeader::read_from(file, part_offset) {
                                return Ok(part_offset);
                            }
                        }
                    }
                }
            }
        }

        // Fallback: default to 0
        Ok(0)
    }

    pub fn get_volume_info(&self) -> VolumeInfo {
        let block_size = self.volume_header.block_size as u64;
        let total_size_bytes = (self.volume_header.total_blocks as u64) * block_size;
        let free_size_bytes = (self.volume_header.free_blocks as u64) * block_size;

        VolumeInfo {
            name: self.catalog.volume_name.clone(),
            signature: if self.volume_header.signature == HFSX_SIGNATURE {
                "HFSX (Case-sensitive)".to_string()
            } else {
                "HFS+ (Mac OS Extended)".to_string()
            },
            block_size: self.volume_header.block_size,
            total_blocks: self.volume_header.total_blocks,
            free_blocks: self.volume_header.free_blocks,
            file_count: self.volume_header.file_count,
            folder_count: self.volume_header.folder_count,
            create_date: mac_time_to_iso(self.volume_header.create_date),
            modify_date: mac_time_to_iso(self.volume_header.modify_date),
            total_size_bytes,
            free_size_bytes,
        }
    }

    pub fn list_directory(&self, folder_id: u32) -> Vec<HfsEntry> {
        let mut entries = self
            .catalog
            .children_by_parent
            .get(&folder_id)
            .cloned()
            .unwrap_or_default();

        // Sort: folders first, then alphabetical by name
        entries.sort_by(|a, b| {
            if a.is_directory != b.is_directory {
                b.is_directory.cmp(&a.is_directory)
            } else {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            }
        });

        entries
    }

    /// Extract a single file given its CNID to a destination file path on Windows
    pub fn extract_file<P: AsRef<Path>>(&mut self, file_id: u32, target_path: P) -> io::Result<u64> {
        let entry = self
            .catalog
            .entries_by_id
            .get(&file_id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "File ID not found in catalog"))?
            .clone();

        if entry.is_directory {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Cannot extract folder directly as file",
            ));
        }

        if let Some(parent) = target_path.as_ref().parent() {
            fs::create_dir_all(parent)?;
        }

        let mut out = File::create(&target_path)?;
        let block_size = self.volume_header.block_size as u64;
        let mut bytes_remaining = entry.size;
        let mut total_written = 0u64;

        for ext in &entry.extents {
            if bytes_remaining == 0 {
                break;
            }

            let ext_disk_offset = self.partition_offset + (ext.start_block as u64 * block_size);
            self.file.seek(SeekFrom::Start(ext_disk_offset))?;

            let ext_bytes_total = (ext.block_count as u64) * block_size;
            let to_read_from_ext = bytes_remaining.min(ext_bytes_total);

            let mut ext_remaining = to_read_from_ext;
            let mut chunk = [0u8; 64 * 1024]; // 64 KB read buffer

            while ext_remaining > 0 {
                let chunk_size = (chunk.len() as u64).min(ext_remaining) as usize;
                self.file.read_exact(&mut chunk[0..chunk_size])?;
                out.write_all(&chunk[0..chunk_size])?;

                ext_remaining -= chunk_size as u64;
                bytes_remaining -= chunk_size as u64;
                total_written += chunk_size as u64;
            }
        }

        out.flush()?;
        Ok(total_written)
    }

    /// Recursively extract a folder and all its contents onto Windows
    fn extract_folder_recursive(
        &mut self,
        folder_id: u32,
        target_dir: &Path,
        stats: &mut ExtractionStats,
    ) -> io::Result<()> {
        fs::create_dir_all(target_dir)?;
        stats.folders_count += 1;

        let children = self.list_directory(folder_id);
        for child in children {
            let safe_name = sanitize_windows_filename(&child.name);
            let child_target = target_dir.join(safe_name);

            if child.is_directory {
                self.extract_folder_recursive(child.id, &child_target, stats)?;
            } else {
                let written = self.extract_file(child.id, &child_target)?;
                stats.files_count += 1;
                stats.bytes_written += written;
            }
        }

        Ok(())
    }

    /// Extract either a file or a folder to a target destination directory or file path
    pub fn extract_entry(
        &mut self,
        entry_id: u32,
        target_destination: &Path,
    ) -> io::Result<ExtractionStats> {
        let is_root = entry_id == ROOT_FOLDER_ID;
        let entry_opt = self.catalog.entries_by_id.get(&entry_id).cloned();

        let (is_dir, name) = if is_root {
            (true, self.catalog.volume_name.clone())
        } else if let Some(e) = entry_opt {
            (e.is_directory, e.name.clone())
        } else {
            return Err(io::Error::new(io::ErrorKind::NotFound, "Entry ID not found"));
        };

        let safe_name = sanitize_windows_filename(&name);

        if is_dir {
            // Target is a directory. If target_destination is an existing folder or path,
            // create subfolder with folder name unless root is targeted
            let final_dir: PathBuf = if target_destination.is_dir() {
                target_destination.join(safe_name)
            } else {
                target_destination.to_path_buf()
            };

            let mut stats = ExtractionStats {
                files_count: 0,
                folders_count: 0,
                bytes_written: 0,
                destination_path: final_dir.to_string_lossy().to_string(),
            };

            self.extract_folder_recursive(entry_id, &final_dir, &mut stats)?;
            Ok(stats)
        } else {
            // Target is a file
            let final_file_path: PathBuf = if target_destination.is_dir() {
                target_destination.join(safe_name)
            } else {
                target_destination.to_path_buf()
            };

            let written = self.extract_file(entry_id, &final_file_path)?;
            Ok(ExtractionStats {
                files_count: 1,
                folders_count: 0,
                bytes_written: written,
                destination_path: final_file_path.to_string_lossy().to_string(),
            })
        }
    }
}
