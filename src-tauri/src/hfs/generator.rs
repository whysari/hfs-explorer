use byteorder::{BigEndian, ByteOrder};
use std::fs::File;
use std::io::{self, Seek, SeekFrom, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use super::types::*;

/// Generates a valid, self-contained 16 MB Apple HFS+ disk image (`.img`)
/// containing a standard folder hierarchy and sample files for immediate testing.
pub fn generate_test_image<P: AsRef<Path>>(dest_path: P) -> io::Result<()> {
    let mut file = File::create(dest_path)?;

    let total_size = 16 * 1024 * 1024; // 16 MB
    let block_size: u32 = 4096;
    let total_blocks: u32 = (total_size / block_size as usize) as u32; // 4096 blocks

    // Pre-allocate 16 MB with zeros
    file.set_len(total_size as u64)?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mac_now = (now as i64 + MAC_TO_UNIX_OFFSET) as u32;

    // --- Prepare Sample Files Content ---
    let hello_text = b"Welcome to Apple HFS+ on Windows!\r\nThis file was read directly from raw HFS+ sectors by hfs-explorer.\r\nBuilt with Rust and Tauri.\r\n";
    let notes_text = b"HFS+ Project Notes:\r\n- Catalog B-Tree: Parsed successfully\r\n- Extents: Allocated sequentially\r\n- Endianness: Big-Endian binary structures\r\n";
    let sample_png = [
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG magic
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15,
        0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01,
        0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
        0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    let catalog_start_block: u32 = 3;
    let catalog_block_count: u32 = 4;
    let node_size: u16 = 4096;

    let hello_block: u32 = 10;
    let notes_block: u32 = 11;
    let png_block: u32 = 12;

    // Write file contents to their allocated blocks
    file.seek(SeekFrom::Start(hello_block as u64 * block_size as u64))?;
    file.write_all(hello_text)?;

    file.seek(SeekFrom::Start(notes_block as u64 * block_size as u64))?;
    file.write_all(notes_text)?;

    file.seek(SeekFrom::Start(png_block as u64 * block_size as u64))?;
    file.write_all(&sample_png)?;

    // --- Build Catalog B-Tree ---
    // Node 0: Catalog Header Node
    let mut node0 = vec![0u8; node_size as usize];
    BigEndian::write_u32(&mut node0[0..4], 1); // f_link = node 1
    BigEndian::write_u32(&mut node0[4..8], 0); // b_link = 0
    node0[8] = 1; // kind = HEADER
    node0[9] = 0; // height = 0
    BigEndian::write_u16(&mut node0[10..12], 3); // num_records = 3

    // BTHeaderRec
    BigEndian::write_u16(&mut node0[14..16], 1); // tree_depth = 1
    BigEndian::write_u32(&mut node0[16..20], 1); // root_node = 1
    BigEndian::write_u32(&mut node0[20..24], 6); // leaf_records = 6
    BigEndian::write_u32(&mut node0[24..28], 1); // first_leaf_node = 1
    BigEndian::write_u32(&mut node0[28..32], 1); // last_leaf_node = 1
    BigEndian::write_u16(&mut node0[32..34], node_size); // node_size = 4096
    BigEndian::write_u16(&mut node0[34..36], 516); // max_key_length
    BigEndian::write_u32(&mut node0[36..40], catalog_block_count); // total_nodes
    BigEndian::write_u32(&mut node0[40..44], catalog_block_count - 2); // free_nodes

    // Node 0 record offsets
    BigEndian::write_u16(&mut node0[4094..4096], 14);
    BigEndian::write_u16(&mut node0[4092..4094], 120);
    BigEndian::write_u16(&mut node0[4090..4092], 256);

    // Node 1: Catalog Leaf Node
    let mut node1 = vec![0u8; node_size as usize];
    BigEndian::write_u32(&mut node1[0..4], 0); // f_link = 0
    BigEndian::write_u32(&mut node1[4..8], 0); // b_link = 0
    node1[8] = 0xFF; // kind = LEAF (-1)
    node1[9] = 1; // height = 1

    let mut record_offsets = Vec::new();
    let mut cur_offset = 14usize;

    let add_record = |node: &mut Vec<u8>, cur_off: &mut usize, rec_offsets: &mut Vec<u16>, parent_id: u32, name: &str, record_bytes: &[u8]| {
        rec_offsets.push(*cur_off as u16);
        let name_utf16: Vec<u16> = name.encode_utf16().collect();
        let key_len = 6 + name_utf16.len() * 2;

        BigEndian::write_u16(&mut node[*cur_off..*cur_off + 2], key_len as u16);
        BigEndian::write_u32(&mut node[*cur_off + 2..*cur_off + 6], parent_id);
        BigEndian::write_u16(&mut node[*cur_off + 6..*cur_off + 8], name_utf16.len() as u16);
        for (idx, ch) in name_utf16.iter().enumerate() {
            BigEndian::write_u16(&mut node[*cur_off + 8 + idx * 2..*cur_off + 10 + idx * 2], *ch);
        }

        let data_off = *cur_off + 2 + key_len;
        node[data_off..data_off + record_bytes.len()].copy_from_slice(record_bytes);
        *cur_off = data_off + record_bytes.len();
        if *cur_off % 2 != 0 {
            *cur_off += 1;
        }
    };

    // 1. Root Volume Thread
    let mut thread_rec = vec![0u8; 10];
    BigEndian::write_u16(&mut thread_rec[0..2], RECORD_TYPE_FOLDER_THREAD);
    BigEndian::write_u32(&mut thread_rec[4..8], 1);
    add_record(&mut node1, &mut cur_offset, &mut record_offsets, 1, "Macintosh HD", &thread_rec);

    // 2. Folder "Documents"
    let mut doc_folder = vec![0u8; 88];
    BigEndian::write_u16(&mut doc_folder[0..2], RECORD_TYPE_FOLDER);
    BigEndian::write_u32(&mut doc_folder[4..8], 1);
    BigEndian::write_u32(&mut doc_folder[8..12], 16);
    BigEndian::write_u32(&mut doc_folder[12..16], mac_now);
    BigEndian::write_u32(&mut doc_folder[16..20], mac_now);
    add_record(&mut node1, &mut cur_offset, &mut record_offsets, ROOT_FOLDER_ID, "Documents", &doc_folder);

    // 3. Folder "Pictures"
    let mut pic_folder = vec![0u8; 88];
    BigEndian::write_u16(&mut pic_folder[0..2], RECORD_TYPE_FOLDER);
    BigEndian::write_u32(&mut pic_folder[4..8], 1);
    BigEndian::write_u32(&mut pic_folder[8..12], 17);
    BigEndian::write_u32(&mut pic_folder[12..16], mac_now);
    BigEndian::write_u32(&mut pic_folder[16..20], mac_now);
    add_record(&mut node1, &mut cur_offset, &mut record_offsets, ROOT_FOLDER_ID, "Pictures", &pic_folder);

    // 4. File "hello_apple.txt"
    let mut file1 = vec![0u8; 248];
    BigEndian::write_u16(&mut file1[0..2], RECORD_TYPE_FILE);
    BigEndian::write_u32(&mut file1[8..12], 18);
    BigEndian::write_u32(&mut file1[12..16], mac_now);
    BigEndian::write_u32(&mut file1[16..20], mac_now);
    BigEndian::write_u64(&mut file1[80..88], hello_text.len() as u64);
    BigEndian::write_u32(&mut file1[92..96], 1);
    BigEndian::write_u32(&mut file1[96..100], hello_block);
    BigEndian::write_u32(&mut file1[100..104], 1);
    add_record(&mut node1, &mut cur_offset, &mut record_offsets, ROOT_FOLDER_ID, "hello_apple.txt", &file1);

    // 5. File "notes.txt"
    let mut file2 = vec![0u8; 248];
    BigEndian::write_u16(&mut file2[0..2], RECORD_TYPE_FILE);
    BigEndian::write_u32(&mut file2[8..12], 19);
    BigEndian::write_u32(&mut file2[12..16], mac_now);
    BigEndian::write_u32(&mut file2[16..20], mac_now);
    BigEndian::write_u64(&mut file2[80..88], notes_text.len() as u64);
    BigEndian::write_u32(&mut file2[92..96], 1);
    BigEndian::write_u32(&mut file2[96..100], notes_block);
    BigEndian::write_u32(&mut file2[100..104], 1);
    add_record(&mut node1, &mut cur_offset, &mut record_offsets, 16, "notes.txt", &file2);

    // 6. File "apple_logo.png"
    let mut file3 = vec![0u8; 248];
    BigEndian::write_u16(&mut file3[0..2], RECORD_TYPE_FILE);
    BigEndian::write_u32(&mut file3[8..12], 20);
    BigEndian::write_u32(&mut file3[12..16], mac_now);
    BigEndian::write_u32(&mut file3[16..20], mac_now);
    BigEndian::write_u64(&mut file3[80..88], sample_png.len() as u64);
    BigEndian::write_u32(&mut file3[92..96], 1);
    BigEndian::write_u32(&mut file3[96..100], png_block);
    BigEndian::write_u32(&mut file3[100..104], 1);
    add_record(&mut node1, &mut cur_offset, &mut record_offsets, 17, "apple_logo.png", &file3);

    BigEndian::write_u16(&mut node1[10..12], record_offsets.len() as u16);

    for (i, off) in record_offsets.iter().enumerate() {
        let pos = (node_size as usize) - 2 * (i + 1);
        BigEndian::write_u16(&mut node1[pos..pos + 2], *off);
    }

    file.seek(SeekFrom::Start(catalog_start_block as u64 * block_size as u64))?;
    file.write_all(&node0)?;
    file.write_all(&node1)?;

    // Volume Header
    let mut vh = vec![0u8; 512];
    BigEndian::write_u16(&mut vh[0..2], HFS_PLUS_SIGNATURE);
    BigEndian::write_u16(&mut vh[2..4], 4);
    BigEndian::write_u32(&mut vh[4..8], 0x00002000);
    BigEndian::write_u32(&mut vh[8..12], 0x31302E30);
    BigEndian::write_u32(&mut vh[16..20], mac_now);
    BigEndian::write_u32(&mut vh[20..24], mac_now);
    BigEndian::write_u32(&mut vh[32..36], 3);
    BigEndian::write_u32(&mut vh[36..40], 2);
    BigEndian::write_u32(&mut vh[40..44], block_size);
    BigEndian::write_u32(&mut vh[44..48], total_blocks);
    BigEndian::write_u32(&mut vh[48..52], total_blocks - 50);
    BigEndian::write_u32(&mut vh[52..56], 50);
    BigEndian::write_u32(&mut vh[64..68], 25);

    BigEndian::write_u64(&mut vh[192..200], (catalog_block_count * block_size) as u64);
    BigEndian::write_u32(&mut vh[200..204], catalog_block_count * block_size);
    BigEndian::write_u32(&mut vh[204..208], catalog_block_count);
    BigEndian::write_u32(&mut vh[208..212], catalog_start_block);
    BigEndian::write_u32(&mut vh[212..216], catalog_block_count);

    file.seek(SeekFrom::Start(1024))?;
    file.write_all(&vh)?;

    file.seek(SeekFrom::Start((total_size - 1024) as u64))?;
    file.write_all(&vh)?;

    file.flush()?;
    Ok(())
}
