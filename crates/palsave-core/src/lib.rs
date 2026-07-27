use std::io::{ Cursor, Read, Write };

use flate2::Compression;
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use serde::{ Deserialize, Serialize };
use uesave::{ Save, SaveReader, StructType, Types };

const MAGIC_PLZ: &[u8; 3] = b"PlZ"; // pre-0.6, zlib
const MAGIC_PLM: &[u8; 3] = b"PlM"; // 0.6 through 1.0, Oodle/Kraken

#[derive(Serialize, Deserialize)]
pub struct EditorSave {
    pub root: Save,
}

pub struct ParsedSave {
    pub save: Save,
    pub decompressed_size: usize,
}

fn palworld_types() -> Types {
    let mut types = Types::new();

    types.add(".worldSaveData.CharacterSaveParameterMap.Key".to_string(), StructType::Struct(None));

    types.add(".worldSaveData.FoliageGridSaveDataMap.Key".to_string(), StructType::Struct(None));

    types.add(
        ".worldSaveData.FoliageGridSaveDataMap.ModelMap.InstanceDataMap.Key".to_string(),
        StructType::Struct(None)
    );

    types.add(
        ".worldSaveData.MapObjectSpawnerInStageSaveData.Key".to_string(),
        StructType::Struct(None)
    );

    types.add(".worldSaveData.ItemContainerSaveData.Key".to_string(), StructType::Struct(None));

    types.add(
        ".worldSaveData.CharacterContainerSaveData.Key".to_string(),
        StructType::Struct(None)
    );

    types
}

/// Decompresses and parses a complete Palworld `.sav` file into a `uesave::Save`.
///
/// This avoids converting the save into JSON, allowing the native API to keep
/// the parsed save in Rust memory.
pub fn parse_sav(data: &[u8]) -> Result<Save, String> {
    parse_sav_with_metadata(data).map(|parsed| parsed.save)
}

/// Decompresses and parses a complete Palworld `.sav`, retaining size metadata.
pub fn parse_sav_with_metadata(data: &[u8]) -> Result<ParsedSave, String> {
    parse_sav_with_metadata_limit(data, usize::MAX)
}

/// Parses a save while refusing containers that exceed `max_decompressed_size`.
///
/// Callers accepting untrusted uploads should use this form to bound decompression memory.
pub fn parse_sav_with_metadata_limit(
    data: &[u8],
    max_decompressed_size: usize
) -> Result<ParsedSave, String> {
    let gvas = decompress_sav_with_limit(data, max_decompressed_size)?;
    let decompressed_size = gvas.len();

    let save = SaveReader::new()
        .types(palworld_types())
        .error_to_raw(true)
        .read(Cursor::new(gvas))
        .map_err(|error| {
            format!("failed to parse GVAS payload ({decompressed_size} bytes): {error}")
        })?;

    Ok(ParsedSave {
        save,
        decompressed_size,
    })
}

/// Writes a parsed `uesave::Save` back into a compressed Palworld `.sav` file.
pub fn write_sav(save: &Save) -> Result<Vec<u8>, String> {
    let mut gvas = Vec::new();

    save.write(&mut gvas).map_err(|error| error.to_string())?;

    compress_sav(&gvas)
}

/// Decompresses the Palworld save container and returns the inner GVAS bytes.
pub fn decompress_sav(data: &[u8]) -> Result<Vec<u8>, String> {
    decompress_sav_with_limit(data, usize::MAX)
}

/// Decompresses a Palworld container with an explicit output-size limit.
pub fn decompress_sav_with_limit(
    data: &[u8],
    max_decompressed_size: usize
) -> Result<Vec<u8>, String> {
    if data.len() < 12 {
        return Err("file too small to be a Palworld save".into());
    }

    let uncompressed_len = u32::from_le_bytes(
        data[0..4].try_into().map_err(|_| "invalid save header")?
    ) as usize;

    let compressed_len = u32::from_le_bytes(
        data[4..8].try_into().map_err(|_| "invalid save header")?
    ) as usize;

    if uncompressed_len > max_decompressed_size {
        return Err(
            format!(
                "decompressed save size {uncompressed_len} exceeds configured limit {max_decompressed_size}"
            )
        );
    }

    let magic = &data[8..11];
    let save_type = data[11];
    let body = &data[12..];

    if body.len() != compressed_len {
        return Err(
            format!("compressed length mismatch: header {compressed_len} vs actual {}", body.len())
        );
    }

    let gvas = if magic == MAGIC_PLZ {
        match save_type {
            0x31 => zlib_decompress_limited(body, max_decompressed_size)?,
            0x32 => {
                let first_pass = zlib_decompress_limited(body, max_decompressed_size)?;
                zlib_decompress_limited(&first_pass, max_decompressed_size)?
            }
            other => {
                return Err(format!("unhandled PlZ type: {other:#x}"));
            }
        }
    } else if magic == MAGIC_PLM {
        oodle_decompress(body, uncompressed_len)?
    } else {
        return Err(format!("not a Palworld save: bad magic {magic:?}"));
    };

    if gvas.len() != uncompressed_len {
        return Err(
            format!(
                "uncompressed length mismatch: header {uncompressed_len} vs actual {}",
                gvas.len()
            )
        );
    }

    Ok(gvas)
}

/// Compresses raw GVAS bytes into a Palworld `.sav` container.
///
/// This currently writes a single-zlib `PlZ` container. Palworld can upgrade
/// the file to `PlM` the next time the game saves it.
pub fn compress_sav(gvas: &[u8]) -> Result<Vec<u8>, String> {
    let uncompressed_len = u32
        ::try_from(gvas.len())
        .map_err(|_| {
            format!("GVAS data is too large for the Palworld save container: {} bytes", gvas.len())
        })?;

    let compressed = zlib_compress(gvas)?;

    let compressed_len = u32
        ::try_from(compressed.len())
        .map_err(|_| {
            format!(
                "compressed save is too large for the Palworld save container: {} bytes",
                compressed.len()
            )
        })?;

    let mut output = Vec::with_capacity(12 + compressed.len());

    output.extend_from_slice(&uncompressed_len.to_le_bytes());
    output.extend_from_slice(&compressed_len.to_le_bytes());
    output.extend_from_slice(MAGIC_PLZ);
    output.push(0x31);
    output.extend_from_slice(&compressed);

    Ok(output)
}

fn oodle_decompress(data: &[u8], output_len: usize) -> Result<Vec<u8>, String> {
    let mut output = vec![0_u8; output_len];

    oozextract::Extractor
        ::new()
        .read_from_slice(data, &mut output)
        .map_err(|error| error.to_string())?;

    Ok(output)
}

fn zlib_decompress_limited(data: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    let read_limit = u64::try_from(limit).unwrap_or(u64::MAX).saturating_add(1);
    ZlibDecoder::new(data)
        .take(read_limit)
        .read_to_end(&mut output)
        .map_err(|error| error.to_string())?;
    if output.len() > limit {
        return Err(format!("decompressed data exceeds configured limit {limit}"));
    }
    Ok(output)
}

fn zlib_compress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());

    encoder.write_all(data).map_err(|error| error.to_string())?;

    encoder.finish().map_err(|error| error.to_string())
}

/// Existing browser/WASM conversion path.
///
/// This remains available for now, but the native API should use `parse_sav()`
/// instead so it does not generate one enormous JSON string.
pub fn sav_to_json_impl(data: &[u8]) -> Result<String, String> {
    let root = parse_sav(data)?;

    serde_json::to_string(&(EditorSave { root })).map_err(|error| error.to_string())
}

/// Existing browser/WASM recompilation path.
pub fn json_to_sav_impl(json: &str) -> Result<Vec<u8>, String> {
    let editor: EditorSave = serde_json::from_str(json).map_err(|error| error.to_string())?;

    write_sav(&editor.root)
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn sav_to_json(data: &[u8]) -> Result<String, JsError> {
        super::sav_to_json_impl(data).map_err(|error| JsError::new(&error))
    }

    #[wasm_bindgen]
    pub fn json_to_sav(json: &str) -> Result<Vec<u8>, JsError> {
        super::json_to_sav_impl(json).map_err(|error| JsError::new(&error))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decompression_limit_accepts_data_at_limit() {
        let data = b"small gvas";
        let save = compress_sav(data).unwrap();
        assert_eq!(decompress_sav_with_limit(&save, data.len()).unwrap(), data);
    }

    #[test]
    fn decompression_limit_rejects_header_before_allocating_output() {
        let data = b"small gvas";
        let save = compress_sav(data).unwrap();
        let error = decompress_sav_with_limit(&save, data.len() - 1).unwrap_err();
        assert!(error.contains("configured limit"));
    }
}
