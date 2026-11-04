use byteorder::{BigEndian, ByteOrder, ReadBytesExt};
use std::collections::HashMap;
use std::io::{self, Cursor, Read, Seek, SeekFrom};

use super::types::*;

pub const NODE_KIND_LEAF: i8 = -1;
#[allow(dead_code)]
pub const NODE_KIND_INDEX: i8 = 0;
pub const NODE_KIND_HEADER: i8 = 1;
#[allow(dead_code)]
pub const NODE_KIND_MAP: i8 = 2;

#[derive(Debug, Clone)]
pub struct BTNodeDescriptor {
    pub f_link: u32,
    #[allow(dead_code)]
    pub b_link: u32,
    pub kind: i8,
    #[allow(dead_code)]
    pub height: u8,
    pub num_records: u16,
    #[allow(dead_code)]
    pub reserved: u16,
}

impl BTNodeDescriptor {
    pub fn read_from<R: Read>(r: &mut R) -> io::Result<Self> {
        let f_link = r.read_u32::<BigEndian>()?;
        let b_link = r.read_u32::<BigEndian>()?;
        let kind = r.read_i8()?;
        let height = r.read_u8()?;
        let num_records = r.read_u16::<BigEndian>()?;
        let reserved = r.read_u16::<BigEndian>()?;

        Ok(Self {
            f_link,
            b_link,
            kind,
            height,
            num_records,
            reserved,
        })
    }
}

#[derive(Debug, Clone)]
pub struct BTHeaderRec {
    pub tree_depth: u16,
    pub root_node: u32,
    pub leaf_records: u32,
    pub first_leaf_node: u32,
    pub last_leaf_node: u32,
    pub node_size: u16,
    pub max_key_length: u16,
    pub total_nodes: u32,
    pub free_nodes: u32,
}

impl BTHeaderRec {
    pub fn read_from<R: Read>(r: &mut R) -> io::Result<Self> {
        let tree_depth = r.read_u16::<BigEndian>()?;
        let root_node = r.read_u32::<BigEndian>()?;
        let leaf_records = r.read_u32::<BigEndian>()?;
        let first_leaf_node = r.read_u32::<BigEndian>()?;
        let last_leaf_node = r.read_u32::<BigEndian>()?;
        let node_size = r.read_u16::<BigEndian>()?;
        let max_key_length = r.read_u16::<BigEndian>()?;
        let total_nodes = r.read_u32::<BigEndian>()?;
        let free_nodes = r.read_u32::<BigEndian>()?;

        Ok(Self {
            tree_depth,
            root_node,
            leaf_records,
            first_leaf_node,
            last_leaf_node,
            node_size,
            max_key_length,
            total_nodes,
            free_nodes,
        })
    }
}

pub struct CatalogTree {
    pub header: BTHeaderRec,
    // Cached index: parent_id -> list of child entries
    pub children_by_parent: HashMap<u32, Vec<HfsEntry>>,
    // Lookup by entry id -> HfsEntry
    pub entries_by_id: HashMap<u32, HfsEntry>,
    // Root volume name (from the thread record of CNID 1 or 2)
    pub volume_name: String,
}

impl CatalogTree {
    /// Read and parse the Catalog B-Tree from the catalog fork stream
    pub fn parse<R: Read + Seek>(
        reader: &mut R,
        catalog_fork: &ForkData,
        volume_header: &VolumeHeader,
        partition_offset: u64,
    ) -> io::Result<Self> {
        // Read node 0 (the Header Node)
        // First extent of catalog file holds node 0
        if catalog_fork.extents.is_empty() || catalog_fork.extents[0].block_count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Catalog file has no extents",
            ));
        }

        let block_size = volume_header.block_size as u64;

        // Function to translate a catalog file offset to an absolute disk offset
        let get_catalog_disk_offset = |file_offset: u64| -> io::Result<u64> {
            let mut current_offset = file_offset;
            for ext in &catalog_fork.extents {
                let ext_bytes = (ext.block_count as u64) * block_size;
                if current_offset < ext_bytes {
                    let disk_block = (ext.start_block as u64) + (current_offset / block_size);
                    let block_rem = current_offset % block_size;
                    return Ok(partition_offset + (disk_block * block_size) + block_rem);
                }
                current_offset -= ext_bytes;
            }
            Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                format!("Offset {} exceeds catalog fork extents", file_offset),
            ))
        };

        // Read Node 0 (we assume minimum 512 bytes for header)
        let node0_disk_offset = get_catalog_disk_offset(0)?;
        reader.seek(SeekFrom::Start(node0_disk_offset))?;

        let node_desc = BTNodeDescriptor::read_from(reader)?;
        if node_desc.kind != NODE_KIND_HEADER {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Node 0 kind is {} (expected HEADER=1)", node_desc.kind),
            ));
        }

        let header_rec = BTHeaderRec::read_from(reader)?;
        let node_size = header_rec.node_size as usize;
        if node_size < 512 || node_size > 65536 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Unreasonable B-Tree node size: {}", node_size),
            ));
        }

        let mut children_by_parent: HashMap<u32, Vec<HfsEntry>> = HashMap::new();
        let mut entries_by_id: HashMap<u32, HfsEntry> = HashMap::new();
        let mut volume_name = "Macintosh HD".to_string();

        // Walk through the leaf nodes linked list
        let mut current_leaf = header_rec.first_leaf_node;
        let mut visited_nodes = std::collections::HashSet::new();

        while current_leaf != 0 {
            if visited_nodes.contains(&current_leaf) {
                break; // avoid infinite loop on corrupted tree
            }
            visited_nodes.insert(current_leaf);

            let node_offset = (current_leaf as u64) * (node_size as u64);
            let disk_offset = match get_catalog_disk_offset(node_offset) {
                Ok(off) => off,
                Err(_) => break,
            };

            reader.seek(SeekFrom::Start(disk_offset))?;
            let mut node_buffer = vec![0u8; node_size];
            reader.read_exact(&mut node_buffer)?;

            let mut cur = Cursor::new(&node_buffer);
            let leaf_desc = match BTNodeDescriptor::read_from(&mut cur) {
                Ok(desc) => desc,
                Err(_) => break,
            };

            if leaf_desc.kind != NODE_KIND_LEAF {
                break;
            }

            let num_records = leaf_desc.num_records as usize;

            // Read the record offsets from the back of the node
            for rec_idx in 0..num_records {
                let offset_pos = node_size - 2 * (rec_idx + 1);
                if offset_pos + 2 > node_size {
                    continue;
                }
                let rec_offset = BigEndian::read_u16(&node_buffer[offset_pos..offset_pos + 2]) as usize;

                if rec_offset >= node_size - 2 {
                    continue;
                }

                // Parse key
                let key_len = BigEndian::read_u16(&node_buffer[rec_offset..rec_offset + 2]) as usize;
                if rec_offset + 2 + key_len > node_size {
                    continue;
                }

                let key_bytes = &node_buffer[rec_offset + 2..rec_offset + 2 + key_len];
                if key_bytes.len() < 6 {
                    continue;
                }

                let parent_id = BigEndian::read_u32(&key_bytes[0..4]);
                let name_len = BigEndian::read_u16(&key_bytes[4..6]) as usize;

                let mut name_u16 = Vec::with_capacity(name_len);
                for i in 0..name_len {
                    let char_pos = 6 + i * 2;
                    if char_pos + 2 <= key_bytes.len() {
                        name_u16.push(BigEndian::read_u16(&key_bytes[char_pos..char_pos + 2]));
                    }
                }
                let node_name = String::from_utf16_lossy(&name_u16);

                // Record data starts immediately after key
                let data_offset = rec_offset + 2 + key_len;
                if data_offset + 2 > node_size {
                    continue;
                }

                let record_type = BigEndian::read_u16(&node_buffer[data_offset..data_offset + 2]);
                let data_bytes = &node_buffer[data_offset..];

                match record_type {
                    RECORD_TYPE_FOLDER => {
                        // Folder record
                        if data_bytes.len() >= 16 {
                            let valence = BigEndian::read_u32(&data_bytes[4..8]);
                            let folder_id = BigEndian::read_u32(&data_bytes[8..12]);
                            let create_date = BigEndian::read_u32(&data_bytes[12..16]);
                            let modify_date = if data_bytes.len() >= 20 {
                                BigEndian::read_u32(&data_bytes[16..20])
                            } else {
                                create_date
                            };

                            let entry = HfsEntry {
                                id: folder_id,
                                parent_id,
                                name: node_name.clone(),
                                is_directory: true,
                                size: 0,
                                create_date: mac_time_to_iso(create_date),
                                modify_date: mac_time_to_iso(modify_date),
                                valence,
                                extents: Vec::new(),
                            };

                            entries_by_id.insert(folder_id, entry.clone());
                            children_by_parent
                                .entry(parent_id)
                                .or_default()
                                .push(entry);
                        }
                    }
                    RECORD_TYPE_FILE => {
                        // File record
                        if data_bytes.len() >= 24 {
                            let file_id = BigEndian::read_u32(&data_bytes[8..12]);
                            let create_date = BigEndian::read_u32(&data_bytes[12..16]);
                            let modify_date = BigEndian::read_u32(&data_bytes[16..20]);

                            let mut logical_size = 0u64;
                            let mut extents = Vec::new();

                            if data_bytes.len() >= 80 + 80 {
                                let fork_bytes = &data_bytes[80..160];
                                logical_size = BigEndian::read_u64(&fork_bytes[0..8]);
                                let _total_blocks = BigEndian::read_u32(&fork_bytes[12..16]);

                                for ext_i in 0..8 {
                                    let ext_pos = 16 + ext_i * 8;
                                    let start_block = BigEndian::read_u32(&fork_bytes[ext_pos..ext_pos + 4]);
                                    let block_count = BigEndian::read_u32(&fork_bytes[ext_pos + 4..ext_pos + 8]);
                                    if block_count > 0 {
                                        extents.push(ExtentDescriptor {
                                            start_block,
                                            block_count,
                                        });
                                    }
                                }
                            }

                            let entry = HfsEntry {
                                id: file_id,
                                parent_id,
                                name: node_name.clone(),
                                is_directory: false,
                                size: logical_size,
                                create_date: mac_time_to_iso(create_date),
                                modify_date: mac_time_to_iso(modify_date),
                                valence: 0,
                                extents,
                            };

                            entries_by_id.insert(file_id, entry.clone());
                            children_by_parent
                                .entry(parent_id)
                                .or_default()
                                .push(entry);
                        }
                    }
                    RECORD_TYPE_FOLDER_THREAD => {
                        // If parent_id is 1 (kHFSRootParentID) or 2, this name is the root volume name!
                        if (parent_id == 1 || parent_id == 2) && !node_name.is_empty() {
                            volume_name = node_name.clone();
                        }
                    }
                    _ => {}
                }
            }

            // Move to next leaf node
            current_leaf = leaf_desc.f_link;
        }

        Ok(Self {
            header: header_rec,
            children_by_parent,
            entries_by_id,
            volume_name,
        })
    }
}
