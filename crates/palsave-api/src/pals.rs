use serde::Serialize;
use std::io::{Cursor, Read, Seek, SeekFrom};
use uesave::{
    ArchiveReader, Byte, ByteArray, Header, Properties, Property, PropertyKey, PropertyTagPartial,
    Save, SaveGameArchiveType, Scope, SoftObjectPath, StructType, StructValue, ValueVec,
    VersionInfo, read_properties_until_none,
};
use uuid::Uuid;

use crate::nodes::PathSegment;

pub const DEFAULT_LIMIT: usize = 50;
pub const MAX_LIMIT: usize = 200;
const WORLD: &str = "worldSaveData";
const PAL_MAP: &str = "CharacterSaveParameterMap";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PalParseStatus {
    Complete,
    Partial,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PalSummary {
    pub id: String,
    pub map_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub character_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gender: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_player_uid: Option<String>,
    pub is_player: bool,
    pub parse_status: PalParseStatus,
    pub raw_path: Vec<PathSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PalDetail {
    pub id: String,
    pub map_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub character_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gender: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_player_uid: Option<String>,
    pub is_player: bool,
    pub parse_status: PalParseStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank_hp: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank_attack: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank_defence: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank_craft_speed: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub talent_hp: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub talent_melee: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub talent_shot: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub talent_defense: Option<i32>,
    pub passive_skills: Vec<String>,
    pub active_skills: Vec<String>,
    pub raw_path: Vec<PathSegment>,
    pub missing_fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PalListResponse {
    pub offset: usize,
    pub limit: usize,
    pub total: usize,
    pub has_more: bool,
    pub items: Vec<PalSummary>,
}

#[derive(Debug, Clone, Default)]
pub struct PalFilter {
    pub search: Option<String>,
    pub character_id: Option<String>,
    pub owner_player_uid: Option<String>,
    pub gender: Option<String>,
    pub min_level: Option<i32>,
    pub max_level: Option<i32>,
    pub include_players: bool,
}

#[derive(Debug, Clone)]
pub struct PalIndexCache {
    pub revision: u64,
    pub items: Vec<PalSummary>,
}

pub fn build_index(save: &Save, revision: u64) -> Result<PalIndexCache, String> {
    let items = character_map(save)?
        .iter()
        .enumerate()
        .map(|(index, entry)| summary(&save.header, index, &entry.key, &entry.value))
        .collect();
    Ok(PalIndexCache { revision, items })
}

pub fn list(
    cache: &PalIndexCache,
    offset: usize,
    limit: usize,
    filter: &PalFilter,
) -> PalListResponse {
    let filtered: Vec<_> = cache
        .items
        .iter()
        .filter(|item| matches_filter(item, filter))
        .collect();
    let total = filtered.len();
    PalListResponse {
        offset,
        limit,
        total,
        has_more: offset.saturating_add(limit) < total,
        items: filtered
            .into_iter()
            .skip(offset)
            .take(limit)
            .cloned()
            .collect(),
    }
}

pub fn detail(save: &Save, id: &str) -> Result<PalDetail, String> {
    let entries = character_map(save)?;
    let index = resolve_id(entries, id).ok_or_else(|| format!("Pal {id} was not found"))?;
    Ok(detail_for(
        &save.header,
        index,
        &entries[index].key,
        &entries[index].value,
    ))
}

fn character_map(save: &Save) -> Result<&[uesave::MapEntry], String> {
    let world = exact(&save.root.properties, WORLD, 0)
        .and_then(as_struct_properties)
        .ok_or_else(|| "worldSaveData is not a parsed struct".to_string())?;
    match exact(world, PAL_MAP, 0) {
        Some(Property::Map(entries)) => Ok(entries),
        Some(Property::Raw(_)) => Err("CharacterSaveParameterMap is raw".to_string()),
        Some(_) => Err("CharacterSaveParameterMap is not a map".to_string()),
        None => Err("CharacterSaveParameterMap was not found".to_string()),
    }
}

fn resolve_id(entries: &[uesave::MapEntry], id: &str) -> Option<usize> {
    if let Some(index) = id.strip_prefix("map:") {
        return index.parse().ok().filter(|index| *index < entries.len());
    }
    let wanted = id.strip_prefix("instance:")?;
    entries.iter().position(|entry| {
        uuid_field(as_struct_properties(&entry.key), "InstanceId")
            .is_some_and(|actual| actual.eq_ignore_ascii_case(wanted))
    })
}

fn matches_filter(item: &PalSummary, filter: &PalFilter) -> bool {
    if item.is_player && !filter.include_players {
        return false;
    }
    if let Some(search) = normalized(&filter.search)
        && ![
            item.character_id.as_deref(),
            item.nickname.as_deref(),
            item.instance_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        .any(|value| value.to_lowercase().contains(&search))
    {
        return false;
    }
    if !equals(item.character_id.as_deref(), &filter.character_id)
        || !equals(item.owner_player_uid.as_deref(), &filter.owner_player_uid)
        || !equals(item.gender.as_deref(), &filter.gender)
    {
        return false;
    }
    if filter
        .min_level
        .is_some_and(|min| item.level.is_none_or(|level| level < min))
        || filter
            .max_level
            .is_some_and(|max| item.level.is_none_or(|level| level > max))
    {
        return false;
    }
    true
}

fn normalized(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase)
}

fn equals(value: Option<&str>, filter: &Option<String>) -> bool {
    normalized(filter)
        .is_none_or(|wanted| value.is_some_and(|actual| actual.eq_ignore_ascii_case(&wanted)))
}

fn summary(header: &Header, index: usize, key: &Property, value: &Property) -> PalSummary {
    let key_properties = as_struct_properties(key);
    let instance_id = uuid_field(key_properties, "InstanceId");
    let key_player_uid = uuid_field(key_properties, "PlayerUId");
    let parsed = save_parameter(header, value);
    let properties = parsed.as_ref().ok();
    let character_id = string_field(properties, "CharacterID");
    let nickname = string_field(properties, "NickName").filter(|value| !value.is_empty());
    let level = int_field(properties, "Level");
    let rank = int_field(properties, "Rank").or_else(|| properties.map(|_| 1));
    let gender = string_field(properties, "Gender").map(|value| enum_tail(&value));
    let owner_player_uid = uuid_field(properties, "OwnerPlayerUId");
    let explicit_player = properties
        .and_then(|properties| property_by_name(properties, "IsPlayer"))
        .and_then(as_bool)
        .unwrap_or(false);
    let is_player = explicit_player
        || character_id
            .as_deref()
            .is_some_and(|id| id.is_empty() || id.eq_ignore_ascii_case("Player"))
        || instance_id
            .as_deref()
            .zip(key_player_uid.as_deref())
            .is_some_and(|(instance, player)| instance == player);
    let required = [
        character_id.is_some(),
        level.is_some(),
        rank.is_some(),
        gender.is_some(),
    ];
    let parse_status = if parsed.is_err() {
        PalParseStatus::Unsupported
    } else if required.into_iter().all(|present| present) {
        PalParseStatus::Complete
    } else {
        PalParseStatus::Partial
    };
    PalSummary {
        id: instance_id
            .as_ref()
            .map_or_else(|| format!("map:{index}"), |uuid| format!("instance:{uuid}")),
        map_index: index,
        instance_id,
        character_id,
        nickname,
        level,
        rank,
        gender,
        owner_player_uid,
        is_player,
        parse_status,
        raw_path: raw_path(index),
    }
}

fn detail_for(header: &Header, index: usize, key: &Property, value: &Property) -> PalDetail {
    let summary = summary(header, index, key, value);
    let parameters = save_parameter(header, value).ok();
    let rank_hp = int_field(parameters.as_ref(), "Rank_HP");
    let rank_attack = int_field(parameters.as_ref(), "Rank_Attack");
    let rank_defence = int_field(parameters.as_ref(), "Rank_Defence");
    let rank_craft_speed = int_field(parameters.as_ref(), "Rank_CraftSpeed");
    let talent_hp = int_field(parameters.as_ref(), "Talent_HP");
    let talent_melee = int_field(parameters.as_ref(), "Talent_Melee");
    let talent_shot = int_field(parameters.as_ref(), "Talent_Shot");
    let talent_defense = int_field(parameters.as_ref(), "Talent_Defense");
    let passive_skills = strings_field(parameters.as_ref(), "PassiveSkillList");
    let active_skills = strings_field(parameters.as_ref(), "EquipWaza");
    let mut missing_fields = Vec::new();
    for (name, missing) in [
        ("characterId", summary.character_id.is_none()),
        ("level", summary.level.is_none()),
        ("rank", summary.rank.is_none()),
        ("gender", summary.gender.is_none()),
        ("rankHp", rank_hp.is_none()),
        ("rankAttack", rank_attack.is_none()),
        ("rankDefence", rank_defence.is_none()),
        ("rankCraftSpeed", rank_craft_speed.is_none()),
        ("talentHp", talent_hp.is_none()),
        ("talentMelee", talent_melee.is_none()),
        ("talentShot", talent_shot.is_none()),
        ("talentDefense", talent_defense.is_none()),
    ] {
        if missing {
            missing_fields.push(name.to_string());
        }
    }
    PalDetail {
        id: summary.id,
        map_index: index,
        instance_id: summary.instance_id,
        character_id: summary.character_id,
        nickname: summary.nickname,
        level: summary.level,
        rank: summary.rank,
        gender: summary.gender,
        owner_player_uid: summary.owner_player_uid,
        is_player: summary.is_player,
        parse_status: summary.parse_status,
        rank_hp,
        rank_attack,
        rank_defence,
        rank_craft_speed,
        talent_hp,
        talent_melee,
        talent_shot,
        talent_defense,
        passive_skills,
        active_skills,
        raw_path: summary.raw_path,
        missing_fields,
    }
}

fn save_parameter(header: &Header, value: &Property) -> Result<Properties, String> {
    let value = as_struct_properties(value).ok_or("map value is not a struct")?;
    let bytes = exact(value, "RawData", 0)
        .and_then(as_bytes)
        .ok_or("RawData is not a byte array")?;
    let mut reader = RawArchive::new(bytes, header);
    let raw = read_properties_until_none(&mut reader)
        .map_err(|error| format!("failed to parse RawData: {error}"))?;
    property_by_name(&raw, "SaveParameter")
        .and_then(as_struct_properties)
        .cloned()
        .ok_or_else(|| "RawData SaveParameter is not a struct".to_string())
}

fn raw_path(index: usize) -> Vec<PathSegment> {
    vec![
        PathSegment::Property {
            name: WORLD.to_string(),
            index: 0,
        },
        PathSegment::StructField {
            name: PAL_MAP.to_string(),
            index: 0,
        },
        PathSegment::MapEntry { index },
    ]
}

pub fn property_by_name<'a>(properties: &'a Properties, name: &str) -> Option<&'a Property> {
    let mut found = properties.0.iter().filter(|(key, _)| key.1 == name);
    let first = found.next();
    if found.next().is_none() {
        first.map(|(_, property)| property)
    } else {
        exact(properties, name, 0)
    }
}

fn exact<'a>(properties: &'a Properties, name: &str, index: u32) -> Option<&'a Property> {
    properties.0.get(&PropertyKey(index, name.to_string()))
}

pub fn as_struct_properties(property: &Property) -> Option<&Properties> {
    match property {
        Property::Struct(StructValue::Struct(properties)) => Some(properties),
        _ => None,
    }
}

pub fn as_string(property: &Property) -> Option<&str> {
    match property {
        Property::Str(value)
        | Property::Name(value)
        | Property::Enum(value)
        | Property::Byte(Byte::Label(value)) => Some(value),
        _ => None,
    }
}

pub fn as_i32(property: &Property) -> Option<i32> {
    match property {
        Property::Int(value) => Some(*value),
        Property::Int8(value) => Some(i32::from(*value)),
        Property::Int16(value) => Some(i32::from(*value)),
        Property::UInt8(value) => Some(i32::from(*value)),
        Property::UInt16(value) => Some(i32::from(*value)),
        Property::Byte(Byte::Byte(value)) => Some(i32::from(*value)),
        _ => None,
    }
}

fn as_bool(property: &Property) -> Option<bool> {
    match property {
        Property::Bool(value) => Some(*value),
        _ => None,
    }
}

pub fn as_uuid_string(property: &Property) -> Option<String> {
    match property {
        Property::Struct(StructValue::Guid(value)) if !value.is_nil() => Some(value.to_string()),
        Property::Str(value) | Property::Name(value) => normalize_uuid(value),
        Property::Struct(StructValue::Struct(properties)) => property_by_name(properties, "Guid")
            .or_else(|| property_by_name(properties, "ID"))
            .and_then(as_uuid_string),
        Property::Array(ValueVec::Byte(ByteArray::Byte(bytes))) if bytes.len() == 16 => {
            guid_bytes(bytes)
        }
        _ => None,
    }
}

pub fn as_string_array(property: &Property) -> Vec<String> {
    match property {
        Property::Array(ValueVec::Name(values))
        | Property::Array(ValueVec::Str(values))
        | Property::Array(ValueVec::Enum(values)) => values.clone(),
        Property::Array(ValueVec::Byte(ByteArray::Label(values))) => values.clone(),
        _ => Vec::new(),
    }
}

fn as_bytes(property: &Property) -> Option<&[u8]> {
    match property {
        Property::Array(ValueVec::Byte(ByteArray::Byte(bytes))) => Some(bytes),
        _ => None,
    }
}

fn int_field(properties: Option<&Properties>, name: &str) -> Option<i32> {
    properties
        .and_then(|properties| property_by_name(properties, name))
        .and_then(as_i32)
}

fn string_field(properties: Option<&Properties>, name: &str) -> Option<String> {
    properties
        .and_then(|properties| property_by_name(properties, name))
        .and_then(as_string)
        .map(ToOwned::to_owned)
}

fn uuid_field(properties: Option<&Properties>, name: &str) -> Option<String> {
    properties
        .and_then(|properties| property_by_name(properties, name))
        .and_then(as_uuid_string)
}

fn strings_field(properties: Option<&Properties>, name: &str) -> Vec<String> {
    properties
        .and_then(|properties| property_by_name(properties, name))
        .map(as_string_array)
        .unwrap_or_default()
        .into_iter()
        .map(|value| enum_tail(&value))
        .collect()
}

fn enum_tail(value: &str) -> String {
    value.rsplit("::").next().unwrap_or(value).to_string()
}

fn normalize_uuid(value: &str) -> Option<String> {
    Uuid::parse_str(value)
        .ok()
        .filter(|uuid| !uuid.is_nil())
        .map(|uuid| uuid.hyphenated().to_string().to_lowercase())
}

fn guid_bytes(bytes: &[u8]) -> Option<String> {
    let words: Vec<[u8; 4]> = bytes
        .chunks_exact(4)
        .map(|chunk| chunk.try_into().ok())
        .collect::<Option<_>>()?;
    let [a, b, c, d]: [[u8; 4]; 4] = words.try_into().ok()?;
    let guid = uesave::FGuid::new(
        u32::from_le_bytes(a),
        u32::from_le_bytes(b),
        u32::from_le_bytes(c),
        u32::from_le_bytes(d),
    );
    (!guid.is_nil()).then(|| guid.to_string())
}

struct RawArchive<'a> {
    stream: Cursor<&'a [u8]>,
    header: &'a Header,
    scope: Scope,
}

impl<'a> RawArchive<'a> {
    fn new(bytes: &'a [u8], header: &'a Header) -> Self {
        Self {
            stream: Cursor::new(bytes),
            header,
            scope: Scope::root(),
        }
    }

    fn string(&mut self) -> Result<(String, Vec<u8>), uesave::Error> {
        let mut length = [0; 4];
        self.read_exact(&mut length)?;
        let length = i32::from_le_bytes(length);
        if length == 0 {
            return Ok((String::new(), Vec::new()));
        }
        if length > 0 {
            let mut bytes = vec![0; length as usize];
            self.read_exact(&mut bytes)?;
            let trailing = if bytes.last() == Some(&0) {
                bytes.pop();
                vec![0]
            } else {
                Vec::new()
            };
            return String::from_utf8(bytes)
                .map(|value| (value, trailing))
                .map_err(|error| uesave::Error::Other(format!("invalid UTF-8: {error}")));
        }
        let units = usize::try_from(
            length
                .checked_abs()
                .ok_or_else(|| uesave::Error::Other("invalid UTF-16 string length".to_string()))?,
        )
        .map_err(|error| uesave::Error::Other(error.to_string()))?;
        let mut bytes = vec![0; units.saturating_mul(2)];
        self.read_exact(&mut bytes)?;
        let trailing = if bytes.ends_with(&[0, 0]) {
            bytes.truncate(bytes.len() - 2);
            vec![0, 0]
        } else {
            Vec::new()
        };
        let units = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();
        String::from_utf16(&units)
            .map(|value| (value, trailing))
            .map_err(|error| uesave::Error::Other(format!("invalid UTF-16: {error}")))
    }
}

impl Read for RawArchive<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        self.stream.read(buffer)
    }
}

impl Seek for RawArchive<'_> {
    fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
        self.stream.seek(position)
    }
}

impl ArchiveReader for RawArchive<'_> {
    type ArchiveType = SaveGameArchiveType;

    fn version(&self) -> &dyn VersionInfo {
        self.header
    }
    fn scope(&mut self) -> &mut Scope {
        &mut self.scope
    }
    fn get_type_or(&mut self, default: &StructType) -> Result<StructType, uesave::Error> {
        Ok(default.clone())
    }
    fn read_string(&mut self) -> Result<String, uesave::Error> {
        self.string().map(|(value, _)| value)
    }
    fn read_string_trailing(&mut self) -> Result<(String, Vec<u8>), uesave::Error> {
        self.string()
    }
    fn read_object_ref(&mut self) -> Result<String, uesave::Error> {
        self.read_string()
    }
    fn read_soft_object_path(&mut self) -> Result<SoftObjectPath, uesave::Error> {
        if self.header.remove_asset_path_fnames() {
            Ok(SoftObjectPath::New {
                asset_path_name: self.read_string()?,
                package_name: self.read_string()?,
                asset_name: self.read_string_trailing()?,
            })
        } else {
            Ok(SoftObjectPath::Old {
                asset_path_name: self.read_string()?,
                sub_path_string: self.read_string()?,
            })
        }
    }
    fn record_schema(&mut self, _path: String, _tag: PropertyTagPartial) {}
    fn path(&self) -> String {
        self.scope.path()
    }
    fn error_to_raw(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_normalization_and_stable_ids() {
        let uuid = "c1b07a9e-7953-4b0e-bd5e-ed18d8df27b3";
        assert_eq!(normalize_uuid(&uuid.to_uppercase()).as_deref(), Some(uuid));
        assert_eq!(normalize_uuid("bad"), None);
        assert_eq!(
            format!("instance:{uuid}"),
            "instance:c1b07a9e-7953-4b0e-bd5e-ed18d8df27b3"
        );
        assert_eq!(format!("map:{}", 412), "map:412");
    }

    #[test]
    fn pagination_filters_and_player_visibility() {
        let make = |index, character: &str, level, gender: &str, player| PalSummary {
            id: format!("map:{index}"),
            map_index: index,
            instance_id: Some(format!("uuid-{index}")),
            character_id: Some(character.into()),
            nickname: None,
            level: Some(level),
            rank: Some(1),
            gender: Some(gender.into()),
            owner_player_uid: Some("owner".into()),
            is_player: player,
            parse_status: PalParseStatus::Complete,
            raw_path: raw_path(index),
        };
        let cache = PalIndexCache {
            revision: 0,
            items: vec![
                make(0, "Sekhmet", 50, "Female", false),
                make(1, "Frostallion", 40, "Male", false),
                make(2, "Player", 50, "Male", true),
            ],
        };
        let page = list(&cache, 0, 1, &PalFilter::default());
        assert_eq!(page.total, 2);
        assert!(page.has_more);
        let filtered = list(
            &cache,
            0,
            50,
            &PalFilter {
                search: Some("frost".into()),
                character_id: Some("FROSTALLION".into()),
                owner_player_uid: Some("OWNER".into()),
                gender: Some("male".into()),
                min_level: Some(40),
                max_level: Some(40),
                include_players: false,
            },
        );
        assert_eq!(filtered.items[0].map_index, 1);
        assert_eq!(
            list(
                &cache,
                0,
                50,
                &PalFilter {
                    include_players: true,
                    ..PalFilter::default()
                }
            )
            .total,
            3
        );
    }
}
