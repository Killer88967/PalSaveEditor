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
    pub container: SavContainer,
}

/// Everything the 12-byte Palworld container header describes, plus a
/// human-readable label for the codec it selects.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavContainer {
    /// The three magic bytes as ASCII, either `PlZ` or `PlM`.
    pub magic: String,
    /// The codec selector byte that follows the magic.
    pub save_type: u8,
    /// `"zlib"`, `"zlib (double)"` or `"Oodle Kraken"`.
    pub compression: &'static str,
    /// Decompressed GVAS length recorded in the header.
    pub decompressed_size: usize,
    /// Compressed payload length recorded in the header.
    pub compressed_size: usize,
}

impl SavContainer {
    /// Ratio of decompressed to compressed bytes, or `0.0` for an empty payload.
    pub fn expansion_ratio(&self) -> f64 {
        if self.compressed_size == 0 {
            return 0.0;
        }
        (self.decompressed_size as f64) / (self.compressed_size as f64)
    }
}

/// Reads the container header without decompressing the payload.
///
/// This is cheap enough to run on every upload, so the UI can describe a save
/// (codec, expected size) even when the GVAS body later fails to parse.
pub fn inspect_container(data: &[u8]) -> Result<SavContainer, String> {
    let header = read_container_header(data)?;

    Ok(SavContainer {
        magic: String::from_utf8_lossy(&header.magic).into_owned(),
        save_type: header.save_type,
        compression: header.compression()?,
        decompressed_size: header.uncompressed_len,
        compressed_size: header.compressed_len,
    })
}

struct ContainerHeader {
    uncompressed_len: usize,
    compressed_len: usize,
    magic: [u8; 3],
    save_type: u8,
    body_len: usize,
}

impl ContainerHeader {
    fn compression(&self) -> Result<&'static str, String> {
        match (&self.magic, self.save_type) {
            (MAGIC_PLZ, 0x31) => Ok("zlib"),
            (MAGIC_PLZ, 0x32) => Ok("zlib (double)"),
            (MAGIC_PLZ, other) => Err(format!("unhandled PlZ type: {other:#x}")),
            (MAGIC_PLM, _) => Ok("Oodle Kraken"),
            (magic, _) => Err(format!("not a Palworld save: bad magic {magic:?}")),
        }
    }
}

fn read_container_header(data: &[u8]) -> Result<ContainerHeader, String> {
    if data.len() < 12 {
        return Err("file too small to be a Palworld save".into());
    }

    let uncompressed_len = u32::from_le_bytes(
        data[0..4].try_into().map_err(|_| "invalid save header")?
    ) as usize;

    let compressed_len = u32::from_le_bytes(
        data[4..8].try_into().map_err(|_| "invalid save header")?
    ) as usize;

    let magic: [u8; 3] = data[8..11].try_into().map_err(|_| "invalid save header")?;

    Ok(ContainerHeader {
        uncompressed_len,
        compressed_len,
        magic,
        save_type: data[11],
        body_len: data.len() - 12,
    })
}

fn palworld_types() -> Types {
    let mut types = Types::new();

    // uesave 0.7 scopes omit the leading dot. Both the key and value need
    // explicit struct hints or the complete map falls back to Property::Raw.

    types.add("worldSaveData.CharacterSaveParameterMap.Key".to_string(), StructType::Struct(None));

    types.add(
        "worldSaveData.CharacterSaveParameterMap.Value".to_string(),
        StructType::Struct(None)
    );

    types.add(".worldSaveData.FoliageGridSaveDataMap.Key".to_string(), StructType::Struct(None));

    types.add(
        ".worldSaveData.FoliageGridSaveDataMap.ModelMap.InstanceDataMap.Key".to_string(),
        StructType::Struct(None)
    );

    types.add(
        ".worldSaveData.MapObjectSpawnerInStageSaveData.Key".to_string(),
        StructType::Struct(None)
    );

    types.add("worldSaveData.ItemContainerSaveData.Key".to_string(), StructType::Struct(None));

    types.add("worldSaveData.CharacterContainerSaveData.Key".to_string(), StructType::Struct(None));

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
    let (gvas, container) = decompress_sav_with_container(data, max_decompressed_size)?;
    let decompressed_size = gvas.len();

    let save = parse_gvas(gvas)?;

    Ok(ParsedSave {
        save,
        decompressed_size,
        container,
    })
}

/// Parses already-decompressed GVAS bytes into a `uesave::Save`.
///
/// The tools page hands users raw GVAS, so it has to be able to come back in.
pub fn parse_gvas(gvas: Vec<u8>) -> Result<Save, String> {
    let len = gvas.len();

    SaveReader::new()
        .types(palworld_types())
        .error_to_raw(true)
        .read(Cursor::new(gvas))
        .map_err(|error| format!("failed to parse GVAS payload ({len} bytes): {error}"))
}

/// Writes a parsed `uesave::Save` back into a compressed Palworld `.sav` file.
pub fn write_sav(save: &Save) -> Result<Vec<u8>, String> {
    compress_sav(&write_gvas(save)?)
}

/// Serializes a parsed `uesave::Save` to uncompressed GVAS bytes.
///
/// This is the "decompiled" form: the exact payload the game compresses into a
/// `.sav` container, suitable for diffing or for external tooling.
pub fn write_gvas(save: &Save) -> Result<Vec<u8>, String> {
    let mut gvas = Vec::new();

    save.write(&mut gvas).map_err(|error| error.to_string())?;

    Ok(gvas)
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
    decompress_sav_with_container(data, max_decompressed_size).map(|(gvas, _)| gvas)
}

/// Decompresses a Palworld container and also reports what the header said.
pub fn decompress_sav_with_container(
    data: &[u8],
    max_decompressed_size: usize
) -> Result<(Vec<u8>, SavContainer), String> {
    let header = read_container_header(data)?;
    let compression = header.compression()?;

    if header.uncompressed_len > max_decompressed_size {
        return Err(
            format!(
                "decompressed save size {} exceeds configured limit {max_decompressed_size}",
                header.uncompressed_len
            )
        );
    }

    if header.body_len != header.compressed_len {
        return Err(
            format!(
                "compressed length mismatch: header {} vs actual {}",
                header.compressed_len,
                header.body_len
            )
        );
    }

    let body = &data[12..];

    let gvas = match (&header.magic, header.save_type) {
        (MAGIC_PLZ, 0x31) => zlib_decompress_limited(body, max_decompressed_size)?,
        (MAGIC_PLZ, 0x32) => {
            let first_pass = zlib_decompress_limited(body, max_decompressed_size)?;
            zlib_decompress_limited(&first_pass, max_decompressed_size)?
        }
        (MAGIC_PLM, _) => oodle_decompress(body, header.uncompressed_len)?,
        // `compression()` above already rejected every other magic/type pair.
        (magic, save_type) => {
            return Err(format!("unhandled container: magic {magic:?}, type {save_type:#x}"));
        }
    };

    if gvas.len() != header.uncompressed_len {
        return Err(
            format!(
                "uncompressed length mismatch: header {} vs actual {}",
                header.uncompressed_len,
                gvas.len()
            )
        );
    }

    Ok((
        gvas,
        SavContainer {
            magic: String::from_utf8_lossy(&header.magic).into_owned(),
            save_type: header.save_type,
            compression,
            decompressed_size: header.uncompressed_len,
            compressed_size: header.compressed_len,
        },
    ))
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

    #[test]
    fn container_inspection_reads_the_header_without_decompressing() {
        let data = b"small gvas payload";
        let save = compress_sav(data).unwrap();

        let container = inspect_container(&save).unwrap();

        assert_eq!(container.magic, "PlZ");
        assert_eq!(container.save_type, 0x31);
        assert_eq!(container.compression, "zlib");
        assert_eq!(container.decompressed_size, data.len());
        assert_eq!(container.compressed_size, save.len() - 12);
        assert!(container.expansion_ratio() > 0.0);
    }

    #[test]
    fn container_inspection_rejects_foreign_files() {
        assert!(inspect_container(b"nope").unwrap_err().contains("too small"));

        let mut bogus = vec![0_u8; 32];
        bogus[8..11].copy_from_slice(b"ZZZ");
        assert!(inspect_container(&bogus).unwrap_err().contains("bad magic"));
    }

    #[test]
    fn decompression_reports_the_container_alongside_the_payload() {
        let data = b"gvas bytes";
        let save = compress_sav(data).unwrap();

        let (gvas, container) = decompress_sav_with_container(&save, usize::MAX).unwrap();

        assert_eq!(gvas, data);
        assert_eq!(container.compression, "zlib");
        assert_eq!(container.decompressed_size, data.len());
    }

    #[test]
    fn expansion_ratio_does_not_divide_by_zero() {
        // A header claiming an empty payload never reaches decompression, but
        // the UI still formats whatever `inspect_container` reports.
        let mut header = vec![0_u8; 12];
        header[8..11].copy_from_slice(MAGIC_PLZ);
        header[11] = 0x31;

        let container = inspect_container(&header).unwrap();

        assert_eq!(container.compressed_size, 0);
        assert_eq!(container.expansion_ratio(), 0.0);
    }
}
