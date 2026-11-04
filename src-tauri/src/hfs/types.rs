use byteorder::{BigEndian, ReadBytesExt};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::io::{self, Read, Seek, SeekFrom};

pub const HFS_PLUS_SIGNATURE: u16 = 0x482B; // 'H+'
pub const HFSX_SIGNATURE: u16 = 0x4858;     // 'HX'

pub const ROOT_FOLDER_ID: u32 = 2; // kHFSRootFolderID
#[allow(dead_code)]
pub const CATALOG_FILE_ID: u32 = 4; // kHFSCatalogFileID

// Record types in the catalog B-Tree
pub const RECORD_TYPE_FOLDER: u16 = 0x0001;
pub const RECORD_TYPE_FILE: u16 = 0x0002;
pub const RECORD_TYPE_FOLDER_THREAD: u16 = 0x0003;
#[allow(dead_code)]
pub const RECORD_TYPE_FILE_THREAD: u16 = 0x0004;

// Difference in seconds between 1904-01-01 and 1970-01-01
pub const MAC_TO_UNIX_OFFSET: i64 = 2_082_844_800;

pub fn mac_time_to_iso(mac_seconds: u32) -> String {
    if mac_seconds == 0 {
        return "N/A".to_string();
    }
    let unix_secs = mac_seconds as i64 - MAC_TO_UNIX_OFFSET;
    if let Some(dt) = DateTime::<Utc>::from_timestamp(unix_secs, 0) {
        dt.format("%Y-%m-%d %H:%M:%S UTC").to_string()
    } else {
        "Invalid Date".to_string()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtentDescriptor {
    pub start_block: u32,
    pub block_count: u32,
}

impl ExtentDescriptor {
    pub fn read_from<R: Read>(r: &mut R) -> io::Result<Self> {
        let start_block = r.read_u32::<BigEndian>()?;
        let block_count = r.read_u32::<BigEndian>()?;
        Ok(Self {
            start_block,
            block_count,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForkData {
    pub logical_size: u64,
    pub clump_size: u32,
    pub total_blocks: u32,
    pub extents: Vec<ExtentDescriptor>,
}

impl ForkData {
    pub fn read_from<R: Read>(r: &mut R) -> io::Result<Self> {
        let logical_size = r.read_u64::<BigEndian>()?;
        let clump_size = r.read_u32::<BigEndian>()?;
        let total_blocks = r.read_u32::<BigEndian>()?;
        let mut extents = Vec::with_capacity(8);
        for _ in 0..8 {
            extents.push(ExtentDescriptor::read_from(r)?);
        }
        Ok(Self {
            logical_size,
            clump_size,
            total_blocks,
            extents,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeHeader {
    pub signature: u16,
    pub version: u16,
    pub attributes: u32,
    pub last_mounted_version: u32,
    pub journal_info_block: u32,
    pub create_date: u32,
    pub modify_date: u32,
    pub backup_date: u32,
    pub checked_date: u32,
    pub file_count: u32,
    pub folder_count: u32,
    pub block_size: u32,
    pub total_blocks: u32,
    pub free_blocks: u32,
    pub next_allocation: u32,
    pub rsrc_clump_size: u32,
    pub data_clump_size: u32,
    pub next_catalog_id: u32,
    pub write_count: u32,
    pub encodings_bitmap: u64,
    pub allocation_file: ForkData,
    pub extents_file: ForkData,
    pub catalog_file: ForkData,
    pub attributes_file: ForkData,
    pub startup_file: ForkData,
}

impl VolumeHeader {
    pub fn read_from<R: Read + Seek>(r: &mut R, partition_offset: u64) -> io::Result<Self> {
        r.seek(SeekFrom::Start(partition_offset + 1024))?;

        let signature = r.read_u16::<BigEndian>()?;
        if signature != HFS_PLUS_SIGNATURE && signature != HFSX_SIGNATURE {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Invalid HFS+ signature: 0x{:04X} (expected 0x482B or 0x4858)", signature),
            ));
        }

        let version = r.read_u16::<BigEndian>()?;
        let attributes = r.read_u32::<BigEndian>()?;
        let last_mounted_version = r.read_u32::<BigEndian>()?;
        let journal_info_block = r.read_u32::<BigEndian>()?;
        let create_date = r.read_u32::<BigEndian>()?;
        let modify_date = r.read_u32::<BigEndian>()?;
        let backup_date = r.read_u32::<BigEndian>()?;
        let checked_date = r.read_u32::<BigEndian>()?;
        let file_count = r.read_u32::<BigEndian>()?;
        let folder_count = r.read_u32::<BigEndian>()?;
        let block_size = r.read_u32::<BigEndian>()?;
        let total_blocks = r.read_u32::<BigEndian>()?;
        let free_blocks = r.read_u32::<BigEndian>()?;
        let next_allocation = r.read_u32::<BigEndian>()?;
        let rsrc_clump_size = r.read_u32::<BigEndian>()?;
        let data_clump_size = r.read_u32::<BigEndian>()?;
        let next_catalog_id = r.read_u32::<BigEndian>()?;
        let write_count = r.read_u32::<BigEndian>()?;
        let encodings_bitmap = r.read_u64::<BigEndian>()?;

        let mut _finder_info = [0u32; 8];
        for i in 0..8 {
            _finder_info[i] = r.read_u32::<BigEndian>()?;
        }

        let allocation_file = ForkData::read_from(r)?;
        let extents_file = ForkData::read_from(r)?;
        let catalog_file = ForkData::read_from(r)?;
        let attributes_file = ForkData::read_from(r)?;
        let startup_file = ForkData::read_from(r)?;

        Ok(Self {
            signature,
            version,
            attributes,
            last_mounted_version,
            journal_info_block,
            create_date,
            modify_date,
            backup_date,
            checked_date,
            file_count,
            folder_count,
            block_size,
            total_blocks,
            free_blocks,
            next_allocation,
            rsrc_clump_size,
            data_clump_size,
            next_catalog_id,
            write_count,
            encodings_bitmap,
            allocation_file,
            extents_file,
            catalog_file,
            attributes_file,
            startup_file,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HfsEntry {
    pub id: u32,
    pub parent_id: u32,
    pub name: String,
    pub is_directory: bool,
    pub size: u64,
    pub create_date: String,
    pub modify_date: String,
    pub valence: u32,
    pub extents: Vec<ExtentDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeInfo {
    pub name: String,
    pub signature: String,
    pub block_size: u32,
    pub total_blocks: u32,
    pub free_blocks: u32,
    pub file_count: u32,
    pub folder_count: u32,
    pub create_date: String,
    pub modify_date: String,
    pub total_size_bytes: u64,
    pub free_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionStats {
    pub files_count: u32,
    pub folders_count: u32,
    pub bytes_written: u64,
    pub destination_path: String,
}
