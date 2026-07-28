use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Cursor, Read},
};
use uesave::{Properties, Property, PropertyKey, Save, StructValue};

const ITEM_CONTAINER_MODULE: &str = "EPalMapObjectConcreteModelModuleType::ItemContainer";
const ZERO_GUID: &str = "00000000-0000-0000-0000-000000000000";

#[derive(Debug)]
pub struct PlayerSaveFile {
    pub file_name: String,
    pub save: Save,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerReference {
    pub kind: String,
    pub container_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerInventoryOwner {
    pub player_uid: String,
    pub file_name: String,
    pub nickname: Option<String>,
    pub personal_containers: Vec<ContainerReference>,
}

pub fn owners(level: &Save, files: &[PlayerSaveFile]) -> Vec<PlayerInventoryOwner> {
    files.iter().filter_map(|file| owner(level, file)).collect()
}

fn owner(level: &Save, file: &PlayerSaveFile) -> Option<PlayerInventoryOwner> {
    let data = exact(&file.save.root.properties, "SaveData").and_then(struct_properties)?;

    let player_uid = exact(data, "PlayerUId").and_then(crate::pals::as_uuid_string)?;

    let inventory = exact(data, "InventoryInfo").and_then(struct_properties);

    let mut personal_containers = Vec::new();

    if let Some(inventory) = inventory {
        for name in [
            "CommonContainerId",
            "DropSlotContainerId",
            "EssentialContainerId",
            "WeaponLoadOutContainerId",
            "PlayerEquipArmorContainerId",
            "FoodEquipContainerId",
        ] {
            if let Some(container_id) = exact(inventory, name).and_then(container_id) {
                personal_containers.push(ContainerReference {
                    kind: name.to_string(),
                    container_id,
                });
            }
        }
    }

    Some(PlayerInventoryOwner {
        nickname: crate::pals::player_nickname(level, &player_uid),
        player_uid,
        file_name: file.file_name.clone(),
        personal_containers,
    })
}

fn container_id(property: &Property) -> Option<String> {
    struct_properties(property)
        .and_then(|properties| exact(properties, "ID"))
        .and_then(crate::pals::as_uuid_string)
}

fn exact<'a>(properties: &'a Properties, name: &str) -> Option<&'a Property> {
    properties.0.get(&PropertyKey(0, name.to_string()))
}

fn struct_properties(property: &Property) -> Option<&Properties> {
    match property {
        Property::Struct(StructValue::Struct(value)) => Some(value),
        _ => None,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventorySlot {
    pub index: usize,
    pub item_id: Option<String>,
    pub quantity: Option<i32>,
    pub editable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryContainer {
    pub kind: String,
    pub container_id: String,
    pub slots: Vec<InventorySlot>,
}

pub fn personal_containers(level: &Save, owner: &PlayerInventoryOwner) -> Vec<InventoryContainer> {
    let Some(map) = item_container_map(level) else {
        return Vec::new();
    };

    owner
        .personal_containers
        .iter()
        .filter_map(|reference| {
            let entry = map.iter().find(|entry| {
                container_id(&entry.key).as_deref() == Some(&reference.container_id)
            })?;

            let value = struct_properties(&entry.value)?;

            let slots = match exact(value, "Slots") {
                Some(Property::Array(uesave::ValueVec::Struct(values))) => values
                    .iter()
                    .enumerate()
                    .map(|(index, slot)| slot_summary(&level.header, index, slot))
                    .collect(),
                _ => Vec::new(),
            };

            Some(InventoryContainer {
                kind: reference.kind.clone(),
                container_id: reference.container_id.clone(),
                slots,
            })
        })
        .collect()
}

fn item_container_map(save: &Save) -> Option<&Vec<uesave::MapEntry>> {
    let world = exact(&save.root.properties, "worldSaveData").and_then(struct_properties)?;

    match exact(world, "ItemContainerSaveData")? {
        Property::Map(value) => Some(value),
        _ => None,
    }
}

fn slot_summary(_header: &uesave::Header, index: usize, slot: &StructValue) -> InventorySlot {
    let data = slot_properties(slot)
        .and_then(|properties| exact(properties, "RawData"))
        .and_then(raw_bytes)
        .and_then(|bytes| decode_slot(bytes).ok());

    InventorySlot {
        index,
        item_id: data.as_ref().map(|value| value.item_id.clone()),
        quantity: data.as_ref().map(|value| value.count),
        editable: data.is_some(),
    }
}

#[derive(Debug, Clone)]
struct SlotData {
    slot_index: i32,
    count: i32,
    item_id: String,
    created: [u8; 16],
    local: [u8; 16],
    trailing: Vec<u8>,
}

fn decode_slot(bytes: &[u8]) -> Result<SlotData, String> {
    let mut cursor = Cursor::new(bytes);

    let slot_index = read_i32(&mut cursor)?;
    let count = read_i32(&mut cursor)?;
    let item_id = read_fstring(&mut cursor)?;

    let mut created = [0; 16];
    let mut local = [0; 16];

    cursor
        .read_exact(&mut created)
        .map_err(|error| error.to_string())?;

    cursor
        .read_exact(&mut local)
        .map_err(|error| error.to_string())?;

    let mut trailing = Vec::new();

    cursor
        .read_to_end(&mut trailing)
        .map_err(|error| error.to_string())?;

    Ok(SlotData {
        slot_index,
        count,
        item_id,
        created,
        local,
        trailing,
    })
}

fn encode_slot(value: &SlotData) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();

    output.extend(value.slot_index.to_le_bytes());
    output.extend(value.count.to_le_bytes());

    write_fstring(&mut output, &value.item_id)?;

    output.extend(value.created);
    output.extend(value.local);
    output.extend(&value.trailing);

    Ok(output)
}

fn read_i32(cursor: &mut Cursor<&[u8]>) -> Result<i32, String> {
    let mut bytes = [0; 4];

    cursor
        .read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;

    Ok(i32::from_le_bytes(bytes))
}

fn read_fstring(cursor: &mut Cursor<&[u8]>) -> Result<String, String> {
    let length = read_i32(cursor)?;

    if length == 0 {
        return Ok(String::new());
    }

    if length > 0 {
        let mut bytes = vec![0; length as usize];

        cursor
            .read_exact(&mut bytes)
            .map_err(|error| error.to_string())?;

        if bytes.last() == Some(&0) {
            bytes.pop();
        }

        String::from_utf8(bytes).map_err(|error| error.to_string())
    } else {
        let count = length.checked_abs().ok_or("invalid FString length")? as usize;

        let mut bytes = vec![0; count * 2];

        cursor
            .read_exact(&mut bytes)
            .map_err(|error| error.to_string())?;

        let mut units = bytes
            .chunks_exact(2)
            .map(|value| u16::from_le_bytes([value[0], value[1]]))
            .collect::<Vec<_>>();

        if units.last() == Some(&0) {
            units.pop();
        }

        String::from_utf16(&units).map_err(|error| error.to_string())
    }
}

fn write_fstring(output: &mut Vec<u8>, value: &str) -> Result<(), String> {
    if value.is_empty() {
        output.extend((0_i32).to_le_bytes());
    } else if value.is_ascii() {
        let length = i32::try_from(value.len() + 1).map_err(|error| error.to_string())?;

        output.extend(length.to_le_bytes());
        output.extend(value.as_bytes());
        output.push(0);
    } else {
        let units = value.encode_utf16().collect::<Vec<_>>();

        let length = i32::try_from(units.len() + 1).map_err(|error| error.to_string())?;

        output.extend((-length).to_le_bytes());

        for unit in units {
            output.extend(unit.to_le_bytes());
        }

        output.extend((0_u16).to_le_bytes());
    }

    Ok(())
}

fn slot_properties(value: &StructValue) -> Option<&Properties> {
    match value {
        StructValue::Struct(properties) => Some(properties),
        _ => None,
    }
}

fn raw_bytes(property: &Property) -> Option<&[u8]> {
    match property {
        Property::Array(uesave::ValueVec::Byte(uesave::ByteArray::Byte(value))) => Some(value),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateSlotRequest {
    pub expected_revision: u64,

    #[serde(default)]
    pub guild: bool,

    pub item_id: Option<String>,
    pub quantity: Option<i32>,
}

pub fn update_slot(
    save: &mut Save,
    container_id_value: &str,
    index: usize,
    request: &UpdateSlotRequest,
) -> Result<InventorySlot, String> {
    if request.item_id.is_none() && request.quantity.is_none() {
        return Err("itemId or quantity must be supplied".into());
    }

    if request.quantity.is_some_and(|value| value < 0) {
        return Err("quantity must not be negative".into());
    }

    if request
        .item_id
        .as_ref()
        .is_some_and(|value| value.chars().count() > 128)
    {
        return Err("itemId must contain at most 128 characters".into());
    }

    let map = item_container_map_mut(save).ok_or("ItemContainerSaveData is unavailable")?;

    let entry = map
        .iter_mut()
        .find(|entry| {
            container_id(&entry.key).is_some_and(|id| id.eq_ignore_ascii_case(container_id_value))
        })
        .ok_or("container was not found")?;

    let value = struct_properties_mut(&mut entry.value).ok_or("container value is unsupported")?;

    let slots = match exact_mut(value, "Slots") {
        Some(Property::Array(uesave::ValueVec::Struct(values))) => values,
        _ => {
            return Err("container Slots has an unsupported type".into());
        }
    };

    let original = slots
        .get(index)
        .ok_or("slot index is out of range")?
        .clone();

    let mut updated = original.clone();

    let properties = slot_properties_mut(&mut updated).ok_or("slot is unsupported")?;

    let raw = match exact_mut(properties, "RawData") {
        Some(Property::Array(uesave::ValueVec::Byte(uesave::ByteArray::Byte(value)))) => value,
        _ => {
            return Err("slot RawData is unsupported".into());
        }
    };

    let mut decoded = decode_slot(raw)?;

    if let Some(quantity) = request.quantity {
        decoded.count = quantity;
    }

    if let Some(item_id) = &request.item_id {
        if *item_id != decoded.item_id && (decoded.created != [0; 16] || decoded.local != [0; 16]) {
            return Err("itemId changes for dynamic equipment \
                 require DynamicItemSaveData \
                 synchronization and are not supported yet"
                .into());
        }

        decoded.item_id = item_id.clone();

        if item_id.is_empty() {
            decoded.count = 0;
            decoded.created = [0; 16];
            decoded.local = [0; 16];
        }
    }

    let encoded = encode_slot(&decoded)?;
    let verified = decode_slot(&encoded)?;

    *raw = encoded;
    slots[index] = updated;

    Ok(InventorySlot {
        index,
        item_id: Some(verified.item_id),
        quantity: Some(verified.count),
        editable: true,
    })
}

fn item_container_map_mut(save: &mut Save) -> Option<&mut Vec<uesave::MapEntry>> {
    let world =
        exact_mut(&mut save.root.properties, "worldSaveData").and_then(struct_properties_mut)?;

    match exact_mut(world, "ItemContainerSaveData")? {
        Property::Map(value) => Some(value),
        _ => None,
    }
}

fn exact_mut<'a>(properties: &'a mut Properties, name: &str) -> Option<&'a mut Property> {
    properties.0.get_mut(&PropertyKey(0, name.to_string()))
}

fn struct_properties_mut(property: &mut Property) -> Option<&mut Properties> {
    match property {
        Property::Struct(StructValue::Struct(value)) => Some(value),
        _ => None,
    }
}

fn slot_properties_mut(value: &mut StructValue) -> Option<&mut Properties> {
    match value {
        StructValue::Struct(properties) => Some(properties),
        _ => None,
    }
}

/// Returns every inventory-bearing map object that belongs to the
/// player's guild.
///
/// Ownership is determined through MapObjectSaveData:
///
/// - Model.RawData[48..64] contains group_id_belong_to.
/// - ItemContainer module RawData[0..16] contains the container ID.
///
/// The container ID is then joined against ItemContainerSaveData.
pub fn guild_containers(level: &Save, owner: &PlayerInventoryOwner) -> Vec<InventoryContainer> {
    let Some(guild_id) = guild_id_for_player(level, &owner.player_uid) else {
        return Vec::new();
    };

    let owners = container_guild_owners(level);

    let Some(map) = item_container_map(level) else {
        return Vec::new();
    };

    map.iter()
        .filter(|entry| {
            container_id(&entry.key)
                .and_then(|container_id| owners.get(&container_id))
                .is_some_and(|owner_guild_id| owner_guild_id.eq_ignore_ascii_case(&guild_id))
        })
        .filter_map(|entry| container_from_entry(level, "GuildStorage", entry))
        .collect()
}

fn guid_from(bytes: &[u8], offset: usize) -> Option<String> {
    let value = bytes.get(offset..offset + 16)?;

    Some(
        uesave::FGuid::new(
            u32::from_le_bytes(value[0..4].try_into().ok()?),
            u32::from_le_bytes(value[4..8].try_into().ok()?),
            u32::from_le_bytes(value[8..12].try_into().ok()?),
            u32::from_le_bytes(value[12..16].try_into().ok()?),
        )
        .to_string(),
    )
}

fn map_object_array(save: &Save) -> Option<&Vec<StructValue>> {
    let world = exact(&save.root.properties, "worldSaveData").and_then(struct_properties)?;

    match exact(world, "MapObjectSaveData")? {
        Property::Array(uesave::ValueVec::Struct(values)) => Some(values),
        _ => None,
    }
}

/// Maps each item-container GUID to the guild that owns its map
/// object.
fn container_guild_owners(save: &Save) -> HashMap<String, String> {
    let mut owners = HashMap::new();

    let Some(objects) = map_object_array(save) else {
        return owners;
    };

    for object in objects {
        let Some(properties) = slot_properties(object) else {
            continue;
        };

        // Fourth GUID in Model.RawData:
        // group_id_belong_to at bytes 48..64.
        let guild_id = exact(properties, "Model")
            .and_then(struct_properties)
            .and_then(|model| exact(model, "RawData"))
            .and_then(raw_bytes)
            .and_then(|bytes| guid_from(bytes, 48));

        // First GUID in the ItemContainer module:
        // target_container_id at bytes 0..16.
        let container_id = exact(properties, "ConcreteModel")
            .and_then(struct_properties)
            .and_then(|concrete_model| exact(concrete_model, "ModuleMap"))
            .and_then(|module_map| match module_map {
                Property::Map(entries) => entries.iter().find_map(|entry| {
                    let module_type = crate::pals::as_string(&entry.key)?;

                    if module_type != ITEM_CONTAINER_MODULE {
                        return None;
                    }

                    struct_properties(&entry.value)
                        .and_then(|value| exact(value, "RawData"))
                        .and_then(raw_bytes)
                        .and_then(|bytes| guid_from(bytes, 0))
                }),
                _ => None,
            });

        if let (Some(guild_id), Some(container_id)) = (guild_id, container_id)
            && !guild_id.eq_ignore_ascii_case(ZERO_GUID)
            && !container_id.eq_ignore_ascii_case(ZERO_GUID)
        {
            owners.insert(container_id, guild_id);
        }
    }

    owners
}

fn container_from_entry(
    level: &Save,
    kind: &str,
    entry: &uesave::MapEntry,
) -> Option<InventoryContainer> {
    let id = container_id(&entry.key)?;

    let value = struct_properties(&entry.value)?;

    let slots = match exact(value, "Slots") {
        Some(Property::Array(uesave::ValueVec::Struct(values))) => values
            .iter()
            .enumerate()
            .map(|(index, value)| slot_summary(&level.header, index, value))
            .collect(),
        _ => Vec::new(),
    };

    Some(InventoryContainer {
        kind: kind.into(),
        container_id: id,
        slots,
    })
}

fn guild_id_for_player(save: &Save, player_uid: &str) -> Option<String> {
    let world = exact(&save.root.properties, "worldSaveData").and_then(struct_properties)?;

    let groups = match exact(world, "GroupSaveDataMap")? {
        Property::Map(value) => value,
        _ => {
            return None;
        }
    };

    for entry in groups {
        let Some(value) = struct_properties(&entry.value) else {
            continue;
        };

        let Some(group_type) = exact(value, "GroupType").and_then(crate::pals::as_string) else {
            continue;
        };

        if group_type != "EPalGroupType::Guild" {
            continue;
        }

        let Some(raw) = exact(value, "RawData").and_then(raw_bytes) else {
            continue;
        };

        let Ok((group_id, members)) = decode_group_members(raw) else {
            continue;
        };

        if members
            .iter()
            .any(|member| member.eq_ignore_ascii_case(player_uid))
        {
            return Some(group_id);
        }
    }

    None
}

fn decode_group_members(raw: &[u8]) -> Result<(String, Vec<String>), String> {
    let mut cursor = Cursor::new(raw);

    let group = read_guid(&mut cursor)?;

    let _ = read_fstring(&mut cursor)?;

    let count = read_i32(&mut cursor)?;

    if !(0..=100_000).contains(&count) {
        return Err("invalid group member count".into());
    }

    let mut members = Vec::with_capacity(count as usize);

    for _ in 0..count {
        members.push(read_guid(&mut cursor)?);

        let _ = read_guid(&mut cursor)?;
    }

    Ok((group, members))
}

fn read_guid(cursor: &mut Cursor<&[u8]>) -> Result<String, String> {
    let mut bytes = [0; 16];

    cursor
        .read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;

    let guid = uesave::FGuid::new(
        u32::from_le_bytes(bytes[0..4].try_into().map_err(|_| "invalid GUID bytes")?),
        u32::from_le_bytes(bytes[4..8].try_into().map_err(|_| "invalid GUID bytes")?),
        u32::from_le_bytes(bytes[8..12].try_into().map_err(|_| "invalid GUID bytes")?),
        u32::from_le_bytes(bytes[12..16].try_into().map_err(|_| "invalid GUID bytes")?),
    );

    Ok(guid.to_string())
}

#[cfg(test)]
mod codec_tests {
    use super::*;

    #[test]
    fn slot_custom_bytes_round_trip_and_preserve_unknown_tail() {
        let original = SlotData {
            slot_index: 7,
            count: 42,
            item_id: "PalSphere_界".into(),
            created: [1; 16],
            local: [2; 16],
            trailing: vec![9, 8, 7, 6],
        };

        let bytes = encode_slot(&original).unwrap();

        let decoded = decode_slot(&bytes).unwrap();

        assert_eq!(decoded.slot_index, 7);
        assert_eq!(decoded.count, 42);
        assert_eq!(decoded.item_id, "PalSphere_界");
        assert_eq!(decoded.created, [1; 16]);
        assert_eq!(decoded.local, [2; 16]);
        assert_eq!(decoded.trailing, vec![9, 8, 7, 6]);

        assert_eq!(encode_slot(&decoded).unwrap(), bytes);
    }

    #[test]
    fn guid_from_rejects_short_data() {
        assert!(guid_from(&[0; 15], 0).is_none());

        assert!(guid_from(&[0; 63], 48).is_none());
    }

    #[test]
    fn guid_from_accepts_complete_guid() {
        let bytes = [0; 64];

        assert_eq!(guid_from(&bytes, 48).as_deref(), Some(ZERO_GUID));
    }
}
