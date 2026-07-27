use serde::{ Deserialize, Serialize };
use std::{
    collections::{ BTreeMap, HashMap, HashSet },
    io::{ Cursor, Read, Seek, SeekFrom, Write },
};
use uesave::{
    ArchiveReader,
    ArchiveWriter,
    Byte,
    ByteArray,
    Header,
    Properties,
    Property,
    PropertyKey,
    PropertyTagPartial,
    Save,
    SaveGameArchiveType,
    Scope,
    SoftObjectPath,
    StructType,
    StructValue,
    ValueVec,
    VersionInfo,
    read_properties_until_none,
    write_properties_none_terminated,
};
use uuid::Uuid;

use crate::nodes::PathSegment;

pub const DEFAULT_LIMIT: usize = 50;
pub const MAX_LIMIT: usize = 200;
const WORLD: &str = "worldSaveData";
const PAL_MAP: &str = "CharacterSaveParameterMap";
pub const MAX_PAL_LEVEL: i32 = 80;
pub const MAX_PAL_RANK: i32 = 5;
pub const MAX_RANK_STAT: i32 = 255;
pub const MAX_TALENT: i32 = 100;
pub const MAX_NICKNAME_CHARS: usize = 64;
pub const MAX_SKILLS: usize = 64;
pub const MAX_SKILL_ID_CHARS: usize = 128;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldUpdate<T> {
    pub value: T,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdatePalRequest {
    pub expected_revision: u64,
    pub nickname: Option<FieldUpdate<String>>,
    pub level: Option<FieldUpdate<i32>>,
    pub rank: Option<FieldUpdate<i32>>,
    pub gender: Option<FieldUpdate<String>>,
    pub rank_hp: Option<FieldUpdate<i32>>,
    pub rank_attack: Option<FieldUpdate<i32>>,
    pub rank_defence: Option<FieldUpdate<i32>>,
    pub rank_craft_speed: Option<FieldUpdate<i32>>,
    pub talent_hp: Option<FieldUpdate<i32>>,
    pub talent_melee: Option<FieldUpdate<i32>>,
    pub talent_shot: Option<FieldUpdate<i32>>,
    pub talent_defense: Option<FieldUpdate<i32>>,
    pub passive_skills: Option<FieldUpdate<Vec<String>>>,
    pub active_skills: Option<FieldUpdate<Vec<String>>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PalEditCapabilities {
    pub nickname: bool,
    pub level: bool,
    pub rank: bool,
    pub gender: bool,
    pub rank_hp: bool,
    pub rank_attack: bool,
    pub rank_defence: bool,
    pub rank_craft_speed: bool,
    pub talent_hp: bool,
    pub talent_melee: bool,
    pub talent_shot: bool,
    pub talent_defense: bool,
    pub passive_skills: bool,
    pub active_skills: bool,
}

#[derive(Debug)]
pub enum UpdateError {
    NotFound(String),
    Validation(BTreeMap<String, String>),
    Internal(String),
}

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
    pub edit_capabilities: PalEditCapabilities,
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
    filter: &PalFilter
) -> PalListResponse {
    let filtered: Vec<_> = cache.items
        .iter()
        .filter(|item| matches_filter(item, filter))
        .collect();
    let total = filtered.len();
    PalListResponse {
        offset,
        limit,
        total,
        has_more: offset.saturating_add(limit) < total,
        items: filtered.into_iter().skip(offset).take(limit).cloned().collect(),
    }
}

pub fn detail(save: &Save, id: &str) -> Result<PalDetail, String> {
    let entries = character_map(save)?;
    let index = resolve_id(entries, id).ok_or_else(|| format!("Pal {id} was not found"))?;
    Ok(detail_for(&save.header, index, &entries[index].key, &entries[index].value))
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
        return index
            .parse()
            .ok()
            .filter(|index| *index < entries.len());
    }
    let wanted = id.strip_prefix("instance:")?;
    entries
        .iter()
        .position(|entry| {
            uuid_field(as_struct_properties(&entry.key), "InstanceId").is_some_and(|actual|
                actual.eq_ignore_ascii_case(wanted)
            )
        })
}

fn matches_filter(item: &PalSummary, filter: &PalFilter) -> bool {
    if item.is_player && !filter.include_players {
        return false;
    }
    if
        let Some(search) = normalized(&filter.search) &&
        ![item.character_id.as_deref(), item.nickname.as_deref(), item.instance_id.as_deref()]
            .into_iter()
            .flatten()
            .any(|value| value.to_lowercase().contains(&search))
    {
        return false;
    }
    if
        !equals(item.character_id.as_deref(), &filter.character_id) ||
        !equals(item.owner_player_uid.as_deref(), &filter.owner_player_uid) ||
        !equals(item.gender.as_deref(), &filter.gender)
    {
        return false;
    }
    if
        filter.min_level.is_some_and(|min| item.level.is_none_or(|level| level < min)) ||
        filter.max_level.is_some_and(|max| item.level.is_none_or(|level| level > max))
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
    normalized(filter).is_none_or(|wanted|
        value.is_some_and(|actual| actual.eq_ignore_ascii_case(&wanted))
    )
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
    let is_player =
        explicit_player ||
        character_id
            .as_deref()
            .is_some_and(|id| (id.is_empty() || id.eq_ignore_ascii_case("Player"))) ||
        instance_id
            .as_deref()
            .zip(key_player_uid.as_deref())
            .is_some_and(|(instance, player)| instance == player);
    let required = [character_id.is_some(), level.is_some(), rank.is_some(), gender.is_some()];
    let parse_status = if parsed.is_err() {
        PalParseStatus::Unsupported
    } else if required.into_iter().all(|present| present) {
        PalParseStatus::Complete
    } else {
        PalParseStatus::Partial
    };
    PalSummary {
        id: instance_id.as_ref().map_or_else(
            || format!("map:{index}"),
            |uuid| format!("instance:{uuid}")
        ),
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
        edit_capabilities: capabilities(parameters.as_ref()),
    }
}

fn save_parameter(header: &Header, value: &Property) -> Result<Properties, String> {
    decode_raw_data(header, value).map(|decoded| decoded.save_parameter().clone())
}

fn capabilities(properties: Option<&Properties>) -> PalEditCapabilities {
    let property = |name| properties.and_then(|p| property_by_name(p, name));
    let integer = |name| property(name).is_some_and(|v| as_i32(v).is_some());
    let strings = |name| {
        property(name).is_some_and(|v| {
            matches!(
                v,
                Property::Array(ValueVec::Name(_)) |
                    Property::Array(ValueVec::Str(_)) |
                    Property::Array(ValueVec::Enum(_)) |
                    Property::Array(ValueVec::Byte(ByteArray::Label(_)))
            )
        })
    };
    PalEditCapabilities {
        nickname: property("NickName").is_some_and(|v| matches!(v, Property::Str(_))),
        level: integer("Level"),
        rank: integer("Rank"),
        gender: property("Gender").is_some_and(|v|
            matches!(v, Property::Enum(_) | Property::Byte(Byte::Label(_)))
        ),
        rank_hp: integer("Rank_HP"),
        rank_attack: integer("Rank_Attack"),
        rank_defence: integer("Rank_Defence"),
        rank_craft_speed: integer("Rank_CraftSpeed"),
        talent_hp: integer("Talent_HP"),
        talent_melee: integer("Talent_Melee"),
        talent_shot: integer("Talent_Shot"),
        talent_defense: integer("Talent_Defense"),
        passive_skills: strings("PassiveSkillList"),
        active_skills: strings("EquipWaza"),
    }
}

struct DecodedRaw {
    properties: Properties,
    suffix: Vec<u8>,
    schemas: HashMap<String, PropertyTagPartial>,
}

impl DecodedRaw {
    fn save_parameter(&self) -> &Properties {
        property_by_name(&self.properties, "SaveParameter")
            .and_then(as_struct_properties)
            .expect("validated SaveParameter")
    }
    fn save_parameter_mut(&mut self) -> Result<&mut Properties, String> {
        exact_mut(&mut self.properties, "SaveParameter", 0)
            .and_then(as_struct_properties_mut)
            .ok_or_else(|| "RawData SaveParameter is not a struct".to_string())
    }
}

fn decode_raw_data(header: &Header, value: &Property) -> Result<DecodedRaw, String> {
    let value = as_struct_properties(value).ok_or("map value is not a struct")?;
    let bytes = exact(value, "RawData", 0).and_then(as_bytes).ok_or("RawData is not a byte array")?;
    let mut reader = RawArchive::new(bytes, header);
    let properties = read_properties_until_none(&mut reader).map_err(|e|
        format!("failed to parse RawData: {e}")
    )?;
    if property_by_name(&properties, "SaveParameter").and_then(as_struct_properties).is_none() {
        return Err("RawData SaveParameter is not a struct".to_string());
    }
    let position = usize::try_from(reader.stream.position()).map_err(|e| e.to_string())?;
    Ok(DecodedRaw {
        properties,
        suffix: bytes[position..].to_vec(),
        schemas: reader.schemas,
    })
}

fn encode_raw_data(header: &Header, decoded: &DecodedRaw) -> Result<Vec<u8>, String> {
    let mut writer = RawWriter::new(header, &decoded.schemas);
    write_properties_none_terminated(&mut writer, &decoded.properties).map_err(|e|
        format!("failed to serialize RawData: {e}")
    )?;
    let mut bytes = writer.stream.into_inner();
    bytes.extend_from_slice(&decoded.suffix);
    Ok(bytes)
}

pub fn update(
    save: &mut Save,
    id: &str,
    request: &UpdatePalRequest
) -> Result<PalDetail, UpdateError> {
    let index = resolve_id(character_map(save).map_err(UpdateError::Internal)?, id).ok_or_else(||
        UpdateError::NotFound(format!("Pal {id} was not found"))
    )?;
    let header = save.header.clone();
    let entries = character_map(save).map_err(UpdateError::Internal)?;
    let key = entries[index].key.clone();
    let mut value = entries[index].value.clone();
    let current = detail_for(&header, index, &key, &value);
    if current.is_player {
        return Err(UpdateError::NotFound(format!("Pal {id} was not found")));
    }
    if
        let Some(expected) = id.strip_prefix("instance:") &&
        current.instance_id.as_deref().is_none_or(|actual| !actual.eq_ignore_ascii_case(expected))
    {
        return Err(UpdateError::NotFound(format!("Pal {id} no longer resolves to that instance")));
    }
    let mut decoded = decode_raw_data(&header, &value).map_err(UpdateError::Internal)?;
    let errors = validate_update(request, decoded.save_parameter());
    if !errors.is_empty() {
        return Err(UpdateError::Validation(errors));
    }
    apply_update(decoded.save_parameter_mut().map_err(UpdateError::Internal)?, request).map_err(
        |(field, message)| UpdateError::Validation(BTreeMap::from([(field, message)]))
    )?;
    let bytes = encode_raw_data(&header, &decoded).map_err(UpdateError::Internal)?;
    set_raw_bytes(&mut value, bytes).map_err(UpdateError::Internal)?;
    decode_raw_data(&header, &value).map_err(|e|
        UpdateError::Internal(format!("serialized Pal failed verification: {e}"))
    )?;
    character_map_mut(save).map_err(UpdateError::Internal)?[index].value = value;
    let entries = character_map(save).map_err(UpdateError::Internal)?;
    Ok(detail_for(&header, index, &entries[index].key, &entries[index].value))
}

fn validate_update(
    request: &UpdatePalRequest,
    properties: &Properties
) -> BTreeMap<String, String> {
    let mut errors = BTreeMap::new();
    let caps = capabilities(Some(properties));
    let mut requested = 0;
    macro_rules! existing {
        ($field:ident, $cap:ident, $wire:literal) => {
            if request.$field.is_some() {
                requested += 1;
                if !caps.$cap {
                    errors.insert(
                        $wire.into(),
                        "Field is absent or has an unsupported property type".into(),
                    );
                }
            }
        };
    }
    existing!(nickname, nickname, "nickname");
    existing!(level, level, "level");
    existing!(rank, rank, "rank");
    existing!(gender, gender, "gender");
    existing!(rank_hp, rank_hp, "rankHp");
    existing!(rank_attack, rank_attack, "rankAttack");
    existing!(rank_defence, rank_defence, "rankDefence");
    existing!(rank_craft_speed, rank_craft_speed, "rankCraftSpeed");
    existing!(talent_hp, talent_hp, "talentHp");
    existing!(talent_melee, talent_melee, "talentMelee");
    existing!(talent_shot, talent_shot, "talentShot");
    existing!(talent_defense, talent_defense, "talentDefense");
    existing!(passive_skills, passive_skills, "passiveSkills");
    existing!(active_skills, active_skills, "activeSkills");
    if requested == 0 {
        errors.insert("request".into(), "At least one Pal field must be supplied".into());
    }
    if let Some(v) = &request.nickname && v.value.chars().count() > MAX_NICKNAME_CHARS {
        errors.insert(
            "nickname".into(),
            format!("Nickname must contain at most {MAX_NICKNAME_CHARS} characters")
        );
    }
    range(
        &mut errors,
        "level",
        request.level.as_ref().map(|v| v.value),
        1,
        MAX_PAL_LEVEL
    );
    range(
        &mut errors,
        "rank",
        request.rank.as_ref().map(|v| v.value),
        1,
        MAX_PAL_RANK
    );
    for (name, value) in [
        ("rankHp", &request.rank_hp),
        ("rankAttack", &request.rank_attack),
        ("rankDefence", &request.rank_defence),
        ("rankCraftSpeed", &request.rank_craft_speed),
    ] {
        range(
            &mut errors,
            name,
            value.as_ref().map(|v| v.value),
            0,
            MAX_RANK_STAT
        );
    }
    for (name, value) in [
        ("talentHp", &request.talent_hp),
        ("talentMelee", &request.talent_melee),
        ("talentShot", &request.talent_shot),
        ("talentDefense", &request.talent_defense),
    ] {
        range(
            &mut errors,
            name,
            value.as_ref().map(|v| v.value),
            0,
            MAX_TALENT
        );
    }
    if let Some(v) = &request.gender && !matches!(enum_tail(&v.value).as_str(), "Male" | "Female") {
        errors.insert(
            "gender".into(),
            "Gender must be EPalGenderType::Male or EPalGenderType::Female".into()
        );
    }
    if let Some(v) = &request.passive_skills {
        validate_skills(&mut errors, "passiveSkills", &v.value);
    }
    if let Some(v) = &request.active_skills {
        validate_skills(&mut errors, "activeSkills", &v.value);
    }
    errors
}

fn range(
    errors: &mut BTreeMap<String, String>,
    field: &str,
    value: Option<i32>,
    min: i32,
    max: i32
) {
    if let Some(v) = value && !(min..=max).contains(&v) {
        errors.insert(field.into(), format!("Value must be between {min} and {max}"));
    }
}
fn validate_skills(errors: &mut BTreeMap<String, String>, field: &str, values: &[String]) {
    if values.len() > MAX_SKILLS {
        errors.insert(field.into(), format!("At most {MAX_SKILLS} skills are allowed"));
        return;
    }
    let mut seen = HashSet::new();
    for value in values {
        if value.is_empty() {
            errors.insert(field.into(), "Skill identifiers cannot be empty".into());
            break;
        }
        if value.chars().count() > MAX_SKILL_ID_CHARS {
            errors.insert(
                field.into(),
                format!("Skill identifiers must contain at most {MAX_SKILL_ID_CHARS} characters")
            );
            break;
        }
        if !seen.insert(value) {
            errors.insert(field.into(), "Duplicate skill identifiers are not allowed".into());
            break;
        }
    }
}

fn apply_update(properties: &mut Properties, r: &UpdatePalRequest) -> Result<(), (String, String)> {
    macro_rules! integer {
        ($field:ident, $name:literal, $wire:literal) => {
            if let Some(v) = &r.$field {
                set_existing_i32(properties, $name, v.value).map_err(|e| ($wire.into(), e))?;
            }
        };
    }
    if let Some(v) = &r.nickname {
        set_existing_string(properties, "NickName", v.value.clone()).map_err(|e| (
            "nickname".into(),
            e,
        ))?;
    }
    integer!(level, "Level", "level");
    integer!(rank, "Rank", "rank");
    integer!(rank_hp, "Rank_HP", "rankHp");
    integer!(rank_attack, "Rank_Attack", "rankAttack");
    integer!(rank_defence, "Rank_Defence", "rankDefence");
    integer!(rank_craft_speed, "Rank_CraftSpeed", "rankCraftSpeed");
    integer!(talent_hp, "Talent_HP", "talentHp");
    integer!(talent_melee, "Talent_Melee", "talentMelee");
    integer!(talent_shot, "Talent_Shot", "talentShot");
    integer!(talent_defense, "Talent_Defense", "talentDefense");
    if let Some(v) = &r.gender {
        set_existing_gender(properties, &v.value).map_err(|e| ("gender".into(), e))?;
    }
    if let Some(v) = &r.passive_skills {
        set_existing_string_vec(properties, "PassiveSkillList", v.value.clone()).map_err(|e| (
            "passiveSkills".into(),
            e,
        ))?;
    }
    if let Some(v) = &r.active_skills {
        set_existing_string_vec(properties, "EquipWaza", v.value.clone()).map_err(|e| (
            "activeSkills".into(),
            e,
        ))?;
    }
    Ok(())
}

fn set_existing_i32(p: &mut Properties, name: &str, value: i32) -> Result<(), String> {
    match exact_mut(p, name, 0).ok_or_else(|| format!("{name} is absent"))? {
        Property::Int(v) => {
            *v = value;
        }
        Property::Int8(v) => {
            *v = i8::try_from(value).map_err(|_| format!("{name} exceeds its Int8 storage"))?;
        }
        Property::Int16(v) => {
            *v = i16::try_from(value).map_err(|_| format!("{name} exceeds its Int16 storage"))?;
        }
        Property::UInt8(v) => {
            *v = u8::try_from(value).map_err(|_| format!("{name} exceeds its UInt8 storage"))?;
        }
        Property::UInt16(v) => {
            *v = u16::try_from(value).map_err(|_| format!("{name} exceeds its UInt16 storage"))?;
        }
        Property::Byte(Byte::Byte(v)) => {
            *v = u8::try_from(value).map_err(|_| format!("{name} exceeds its byte storage"))?;
        }
        _ => {
            return Err(format!("{name} has an unsupported property type"));
        }
    }
    Ok(())
}
fn set_existing_string(p: &mut Properties, name: &str, value: String) -> Result<(), String> {
    match exact_mut(p, name, 0).ok_or_else(|| format!("{name} is absent"))? {
        Property::Str(v) => {
            *v = value;
        }
        _ => {
            return Err(format!("{name} is not a string property"));
        }
    }
    Ok(())
}
fn set_existing_gender(p: &mut Properties, value: &str) -> Result<(), String> {
    let tail = enum_tail(value);
    match exact_mut(p, "Gender", 0).ok_or("Gender is absent")? {
        Property::Enum(v) | Property::Byte(Byte::Label(v)) => {
            let prefix = v
                .rsplit_once("::")
                .map(|(p, _)| format!("{p}::"))
                .unwrap_or_default();
            *v = format!("{prefix}{tail}");
        }
        _ => {
            return Err("Gender has an unsupported property type".into());
        }
    }
    Ok(())
}
fn set_existing_string_vec(
    p: &mut Properties,
    name: &str,
    values: Vec<String>
) -> Result<(), String> {
    match exact_mut(p, name, 0).ok_or_else(|| format!("{name} is absent"))? {
        | Property::Array(ValueVec::Name(v))
        | Property::Array(ValueVec::Str(v))
        | Property::Array(ValueVec::Enum(v)) => {
            *v = values;
        }
        Property::Array(ValueVec::Byte(ByteArray::Label(v))) => {
            *v = values;
        }
        _ => {
            return Err(format!("{name} is not a supported string array"));
        }
    }
    Ok(())
}
fn set_raw_bytes(value: &mut Property, bytes: Vec<u8>) -> Result<(), String> {
    match as_struct_properties_mut(value).and_then(|p| exact_mut(p, "RawData", 0)) {
        Some(Property::Array(ValueVec::Byte(ByteArray::Byte(v)))) => {
            *v = bytes;
            Ok(())
        }
        _ => Err("RawData is not a byte array".into()),
    }
}
fn exact_mut<'a>(
    properties: &'a mut Properties,
    name: &str,
    index: u32
) -> Option<&'a mut Property> {
    properties.0.get_mut(&PropertyKey(index, name.to_string()))
}
fn as_struct_properties_mut(property: &mut Property) -> Option<&mut Properties> {
    match property {
        Property::Struct(StructValue::Struct(p)) => Some(p),
        _ => None,
    }
}
fn character_map_mut(save: &mut Save) -> Result<&mut Vec<uesave::MapEntry>, String> {
    let world = exact_mut(&mut save.root.properties, WORLD, 0)
        .and_then(as_struct_properties_mut)
        .ok_or("worldSaveData is not a parsed struct")?;
    match exact_mut(world, PAL_MAP, 0) {
        Some(Property::Map(v)) => Ok(v),
        _ => Err("CharacterSaveParameterMap is not a map".into()),
    }
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
        PathSegment::MapEntry { index }
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
        | Property::Str(value)
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
        Property::Struct(StructValue::Struct(properties)) =>
            property_by_name(properties, "Guid")
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
        | Property::Array(ValueVec::Name(values))
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
    properties.and_then(|properties| property_by_name(properties, name)).and_then(as_i32)
}

fn string_field(properties: Option<&Properties>, name: &str) -> Option<String> {
    properties
        .and_then(|properties| property_by_name(properties, name))
        .and_then(as_string)
        .map(ToOwned::to_owned)
}

fn uuid_field(properties: Option<&Properties>, name: &str) -> Option<String> {
    properties.and_then(|properties| property_by_name(properties, name)).and_then(as_uuid_string)
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
        u32::from_le_bytes(d)
    );
    (!guid.is_nil()).then(|| guid.to_string())
}

struct RawArchive<'a> {
    stream: Cursor<&'a [u8]>,
    header: &'a Header,
    scope: Scope,
    schemas: HashMap<String, PropertyTagPartial>,
}

impl<'a> RawArchive<'a> {
    fn new(bytes: &'a [u8], header: &'a Header) -> Self {
        Self {
            stream: Cursor::new(bytes),
            header,
            scope: Scope::root(),
            schemas: HashMap::new(),
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
        let units = usize
            ::try_from(
                length
                    .checked_abs()
                    .ok_or_else(||
                        uesave::Error::Other("invalid UTF-16 string length".to_string())
                    )?
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
    fn record_schema(&mut self, path: String, tag: PropertyTagPartial) {
        self.schemas.insert(path, tag);
    }
    fn path(&self) -> String {
        self.scope.path()
    }
    fn error_to_raw(&self) -> bool {
        true
    }
}

struct RawWriter<'a> {
    stream: Cursor<Vec<u8>>,
    header: &'a Header,
    scope: Scope,
    schemas: &'a HashMap<String, PropertyTagPartial>,
}
impl<'a> RawWriter<'a> {
    fn new(header: &'a Header, schemas: &'a HashMap<String, PropertyTagPartial>) -> Self {
        Self {
            stream: Cursor::new(Vec::new()),
            header,
            scope: Scope::root(),
            schemas,
        }
    }
}
impl Write for RawWriter<'_> {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.stream.write(b)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl Seek for RawWriter<'_> {
    fn seek(&mut self, p: SeekFrom) -> std::io::Result<u64> {
        self.stream.seek(p)
    }
}
impl ArchiveWriter for RawWriter<'_> {
    type ArchiveType = SaveGameArchiveType;
    fn version(&self) -> &dyn VersionInfo {
        self.header
    }
    fn set_version(&mut self, _header: Header) {}
    fn scope(&mut self) -> &mut Scope {
        &mut self.scope
    }
    fn write_string(&mut self, value: &str) -> Result<(), uesave::Error> {
        self.write_string_trailing(value, None)
    }
    fn write_string_trailing(
        &mut self,
        value: &str,
        trailing: Option<&[u8]>
    ) -> Result<(), uesave::Error> {
        if value.is_empty() || value.is_ascii() {
            let tail = trailing.unwrap_or(&[0]);
            self.write_all(
                &u32
                    ::try_from(value.len() + tail.len())
                    .map_err(|e| uesave::Error::Other(e.to_string()))?
                    .to_le_bytes()
            )?;
            self.write_all(value.as_bytes())?;
            self.write_all(tail)?;
        } else {
            let units: Vec<u16> = value.encode_utf16().collect();
            let tail = trailing.unwrap_or(&[0, 0]);
            let count = i32
                ::try_from(units.len() + tail.len() / 2)
                .map_err(|e| uesave::Error::Other(e.to_string()))?;
            self.write_all(&(-count).to_le_bytes())?;
            for unit in units {
                self.write_all(&unit.to_le_bytes())?;
            }
            self.write_all(tail)?;
        }
        Ok(())
    }
    fn write_object_ref(&mut self, value: &String) -> Result<(), uesave::Error> {
        self.write_string(value)
    }
    fn write_soft_object_path(&mut self, value: &SoftObjectPath) -> Result<(), uesave::Error> {
        match value {
            SoftObjectPath::New { asset_path_name, package_name, asset_name } => {
                self.write_string(asset_path_name)?;
                self.write_string(package_name)?;
                self.write_string_trailing(&asset_name.0, Some(&asset_name.1))?;
            }
            SoftObjectPath::Old { asset_path_name, sub_path_string } => {
                self.write_string(asset_path_name)?;
                self.write_string(sub_path_string)?;
            }
        }
        Ok(())
    }
    fn get_schema(&self, path: &str) -> Option<PropertyTagPartial> {
        self.schemas.get(path).cloned()
    }
    fn path(&self) -> String {
        self.scope.path()
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
        assert_eq!(format!("instance:{uuid}"), "instance:c1b07a9e-7953-4b0e-bd5e-ed18d8df27b3");
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
                make(2, "Player", 50, "Male", true)
            ],
        };
        let page = list(&cache, 0, 1, &PalFilter::default());
        assert_eq!(page.total, 2);
        assert!(page.has_more);
        let filtered = list(
            &cache,
            0,
            50,
            &(PalFilter {
                search: Some("frost".into()),
                character_id: Some("FROSTALLION".into()),
                owner_player_uid: Some("OWNER".into()),
                gender: Some("male".into()),
                min_level: Some(40),
                max_level: Some(40),
                include_players: false,
            })
        );
        assert_eq!(filtered.items[0].map_index, 1);
        assert_eq!(
            list(
                &cache,
                0,
                50,
                &(PalFilter {
                    include_players: true,
                    ..PalFilter::default()
                })
            ).total,
            3
        );
    }

    fn editable_properties() -> Properties {
        let mut p = Properties::default();
        for (name, value) in [
            ("Level", Property::Byte(Byte::Byte(10))),
            ("Rank", Property::Byte(Byte::Byte(1))),
            ("Rank_HP", Property::Byte(Byte::Byte(0))),
            ("Rank_Attack", Property::Byte(Byte::Byte(0))),
            ("Rank_Defence", Property::Byte(Byte::Byte(0))),
            ("Rank_CraftSpeed", Property::Byte(Byte::Byte(0))),
            ("Talent_HP", Property::Byte(Byte::Byte(50))),
            ("Talent_Melee", Property::Byte(Byte::Byte(50))),
            ("Talent_Shot", Property::Byte(Byte::Byte(50))),
            ("Talent_Defense", Property::Byte(Byte::Byte(50))),
        ] {
            p.insert(PropertyKey(0, name.into()), value);
        }
        p.insert(PropertyKey(0, "NickName".into()), Property::Str("old".into()));
        p.insert(PropertyKey(0, "Gender".into()), Property::Enum("EPalGenderType::Male".into()));
        p.insert(
            PropertyKey(0, "PassiveSkillList".into()),
            Property::Array(ValueVec::Name(vec!["A".into()]))
        );
        p.insert(
            PropertyKey(0, "EquipWaza".into()),
            Property::Array(ValueVec::Enum(vec!["B".into()]))
        );
        p.insert(PropertyKey(0, "Untouched".into()), Property::Str("preserve".into()));
        p
    }

    #[test]
    fn validates_all_numeric_boundaries_and_gender() {
        let p = editable_properties();
        for (field, request) in [
            (
                "level",
                UpdatePalRequest {
                    level: Some(FieldUpdate { value: 0 }),
                    ..Default::default()
                },
            ),
            (
                "level",
                UpdatePalRequest {
                    level: Some(FieldUpdate { value: 81 }),
                    ..Default::default()
                },
            ),
            (
                "rank",
                UpdatePalRequest {
                    rank: Some(FieldUpdate { value: 0 }),
                    ..Default::default()
                },
            ),
            (
                "rank",
                UpdatePalRequest {
                    rank: Some(FieldUpdate { value: 6 }),
                    ..Default::default()
                },
            ),
            (
                "rankHp",
                UpdatePalRequest {
                    rank_hp: Some(FieldUpdate { value: -1 }),
                    ..Default::default()
                },
            ),
            (
                "rankHp",
                UpdatePalRequest {
                    rank_hp: Some(FieldUpdate { value: 256 }),
                    ..Default::default()
                },
            ),
            (
                "talentHp",
                UpdatePalRequest {
                    talent_hp: Some(FieldUpdate { value: -1 }),
                    ..Default::default()
                },
            ),
            (
                "talentHp",
                UpdatePalRequest {
                    talent_hp: Some(FieldUpdate { value: 101 }),
                    ..Default::default()
                },
            ),
            (
                "gender",
                UpdatePalRequest {
                    gender: Some(FieldUpdate {
                        value: "Other".into(),
                    }),
                    ..Default::default()
                },
            ),
        ] {
            assert!(validate_update(&request, &p).contains_key(field));
        }
        assert!(
            validate_update(
                &(UpdatePalRequest {
                    level: Some(FieldUpdate { value: 80 }),
                    rank: Some(FieldUpdate { value: 5 }),
                    rank_hp: Some(FieldUpdate { value: 255 }),
                    talent_hp: Some(FieldUpdate { value: 100 }),
                    gender: Some(FieldUpdate {
                        value: "EPalGenderType::Female".into(),
                    }),
                    ..Default::default()
                }),
                &p
            ).is_empty()
        );
    }

    #[test]
    fn validates_nickname_and_skill_lists() {
        let p = editable_properties();
        let long = "界".repeat(65);
        assert!(
            validate_update(
                &(UpdatePalRequest {
                    nickname: Some(FieldUpdate { value: long }),
                    ..Default::default()
                }),
                &p
            ).contains_key("nickname")
        );
        for values in [
            vec!["".into()],
            vec!["A".into(), "A".into()],
            vec!["x".repeat(129)],
            vec!["x".into(); 65],
        ] {
            assert!(
                validate_update(
                    &(UpdatePalRequest {
                        passive_skills: Some(FieldUpdate { value: values }),
                        ..Default::default()
                    }),
                    &p
                ).contains_key("passiveSkills")
            );
        }
    }

    #[test]
    fn applies_every_supported_field_and_preserves_untouched_properties() {
        let mut p = editable_properties();
        let untouched = property_by_name(&p, "Untouched").cloned();
        let request = UpdatePalRequest {
            nickname: Some(FieldUpdate { value: "".into() }),
            level: Some(FieldUpdate { value: 80 }),
            rank: Some(FieldUpdate { value: 5 }),
            gender: Some(FieldUpdate {
                value: "Female".into(),
            }),
            rank_hp: Some(FieldUpdate { value: 1 }),
            rank_attack: Some(FieldUpdate { value: 2 }),
            rank_defence: Some(FieldUpdate { value: 3 }),
            rank_craft_speed: Some(FieldUpdate { value: 4 }),
            talent_hp: Some(FieldUpdate { value: 91 }),
            talent_melee: Some(FieldUpdate { value: 92 }),
            talent_shot: Some(FieldUpdate { value: 93 }),
            talent_defense: Some(FieldUpdate { value: 94 }),
            passive_skills: Some(FieldUpdate {
                value: vec!["P1".into(), "P2".into()],
            }),
            active_skills: Some(FieldUpdate {
                value: vec!["W1".into()],
            }),
            ..Default::default()
        };
        apply_update(&mut p, &request).unwrap();
        assert_eq!(int_field(Some(&p), "Level"), Some(80));
        assert_eq!(int_field(Some(&p), "Rank"), Some(5));
        assert_eq!(string_field(Some(&p), "NickName").as_deref(), Some(""));
        assert_eq!(string_field(Some(&p), "Gender").as_deref(), Some("EPalGenderType::Female"));
        for (name, value) in [
            ("Rank_HP", 1),
            ("Rank_Attack", 2),
            ("Rank_Defence", 3),
            ("Rank_CraftSpeed", 4),
            ("Talent_HP", 91),
            ("Talent_Melee", 92),
            ("Talent_Shot", 93),
            ("Talent_Defense", 94),
        ] {
            assert_eq!(int_field(Some(&p), name), Some(value));
        }
        assert_eq!(strings_field(Some(&p), "PassiveSkillList"), vec!["P1", "P2"]);
        assert_eq!(property_by_name(&p, "Untouched").cloned(), untouched);
    }

    #[test]
    fn missing_and_wrong_variant_fields_are_never_created_or_retyped() {
        let mut p = editable_properties();
        p.0.shift_remove(&PropertyKey(0, "Rank".into()));
        p.insert(PropertyKey(0, "Level".into()), Property::Str("wrong".into()));
        let before = p.clone();
        let errors = validate_update(
            &(UpdatePalRequest {
                rank: Some(FieldUpdate { value: 2 }),
                level: Some(FieldUpdate { value: 2 }),
                ..Default::default()
            }),
            &p
        );
        assert!(errors.contains_key("rank"));
        assert!(errors.contains_key("level"));
        assert_eq!(p, before);
    }
}
