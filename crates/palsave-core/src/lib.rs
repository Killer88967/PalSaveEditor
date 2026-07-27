use std::io::{Cursor, Read, Write};
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use serde::{Serialize, Deserialize};
use uesave::Save;

const MAGIC_PLZ: &[u8; 3] = b"PlZ"; // pre-0.6, zlib
const MAGIC_PLM: &[u8; 3] = b"PlM"; // 0.6 through 1.0, Oodle/Kraken

#[derive(Serialize, Deserialize)]
pub struct EditorSave {
    pub root: Save,
}

pub fn decompress_sav(data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 12 {
        return Err("file too small to be a Palworld save".into());
    }
    let uncompressed_len = u32::from_le_bytes(data[0..4].try_into().unwrap()) as usize;
    let magic = &data[8..11];
    let save_type = data[11];
    let body = &data[12..];

    let gvas = if magic == MAGIC_PLZ {
        match save_type {
            0x31 => zlib_decompress(body)?,
            0x32 => zlib_decompress(&zlib_decompress(body)?)?,
            other => return Err(format!("unhandled PlZ type: {other:#x}")),
        }
    } else if magic == MAGIC_PLM {
        oodle_decompress(body, uncompressed_len)?
    } else {
        return Err(format!("not a Palworld save: bad magic {magic:?}"));
    };

    if gvas.len() != uncompressed_len {
        return Err(format!(
            "uncompressed length mismatch: header {uncompressed_len} vs actual {}",
            gvas.len()
        ));
    }
    Ok(gvas)
}

pub fn compress_sav(gvas: &[u8]) -> Result<Vec<u8>, String> {
    // Always write PlZ single-zlib (0x31); the game upgrades it to PlM on next save.
    let uncompressed_len = gvas.len() as u32;
    let compressed = zlib_compress(gvas)?;
    let compressed_len = compressed.len() as u32;
    let mut out = Vec::with_capacity(12 + compressed.len());
    out.extend_from_slice(&uncompressed_len.to_le_bytes());
    out.extend_from_slice(&compressed_len.to_le_bytes());
    out.extend_from_slice(MAGIC_PLZ);
    out.push(0x31);
    out.extend_from_slice(&compressed);
    Ok(out)
}

fn oodle_decompress(data: &[u8], out_len: usize) -> Result<Vec<u8>, String> {
    let mut out = vec![0u8; out_len];
    oozextract::Extractor::new()
        .read_from_slice(data, &mut out)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

fn zlib_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    ZlibDecoder::new(data).read_to_end(&mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

fn zlib_compress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut e = ZlibEncoder::new(Vec::new(), Compression::default());
    e.write_all(data).map_err(|e| e.to_string())?;
    e.finish().map_err(|e| e.to_string())
}

pub fn sav_to_json_impl(data: &[u8]) -> Result<String, String> {
    let gvas = decompress_sav(data)?;
    let root = Save::read(&mut Cursor::new(gvas)).map_err(|e| e.to_string())?;
    serde_json::to_string(&(EditorSave { root })).map_err(|e| e.to_string())
}

pub fn json_to_sav_impl(json: &str) -> Result<Vec<u8>, String> {
    let editor: EditorSave = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let mut gvas = Vec::new();
    editor.root.write(&mut gvas).map_err(|e| e.to_string())?;
    compress_sav(&gvas)
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn sav_to_json(data: &[u8]) -> Result<String, JsError> {
        super::sav_to_json_impl(data).map_err(|e| JsError::new(&e))
    }

    #[wasm_bindgen]
    pub fn json_to_sav(json: &str) -> Result<Vec<u8>, JsError> {
        super::json_to_sav_impl(json).map_err(|e| JsError::new(&e))
    }
}
