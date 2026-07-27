use serde::{ Deserialize, Serialize };
use std::io::{ Cursor, Read };
use uesave::{ Properties, Property, PropertyKey, Save, StructValue };

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
    files
        .iter()
        .filter_map(|file| owner(level, file))
        .collect()
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
        .and_then(|p| exact(p, "ID"))
        .and_then(crate::pals::as_uuid_string)
}
fn exact<'a>(p: &'a Properties, name: &str) -> Option<&'a Property> {
    p.0.get(&PropertyKey(0, name.to_string()))
}
fn struct_properties(property: &Property) -> Option<&Properties> {
    match property {
        Property::Struct(StructValue::Struct(v)) => Some(v),
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
    owner.personal_containers
        .iter()
        .filter_map(|reference| {
            let entry = map
                .iter()
                .find(|entry| {
                    container_id(&entry.key).as_deref() == Some(&reference.container_id)
                })?;
            let value = struct_properties(&entry.value)?;
            let slots = match exact(value, "Slots") {
                Some(Property::Array(uesave::ValueVec::Struct(values))) =>
                    values
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
        Property::Map(v) => Some(v),
        _ => None,
    }
}
fn slot_summary(_header: &uesave::Header, index: usize, slot: &StructValue) -> InventorySlot {
    let data = slot_properties(slot)
        .and_then(|p| exact(p, "RawData"))
        .and_then(raw_bytes)
        .and_then(|b| decode_slot(b).ok());
    InventorySlot {
        index,
        item_id: data.as_ref().map(|v| v.item_id.clone()),
        quantity: data.as_ref().map(|v| v.count),
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
    let mut c = Cursor::new(bytes);
    let slot_index = read_i32(&mut c)?;
    let count = read_i32(&mut c)?;
    let item_id = read_fstring(&mut c)?;
    let mut created = [0; 16];
    let mut local = [0; 16];
    c.read_exact(&mut created).map_err(|e| e.to_string())?;
    c.read_exact(&mut local).map_err(|e| e.to_string())?;
    let mut trailing = Vec::new();
    c.read_to_end(&mut trailing).map_err(|e| e.to_string())?;
    Ok(SlotData {
        slot_index,
        count,
        item_id,
        created,
        local,
        trailing,
    })
}
fn encode_slot(v: &SlotData) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    out.extend(v.slot_index.to_le_bytes());
    out.extend(v.count.to_le_bytes());
    write_fstring(&mut out, &v.item_id)?;
    out.extend(v.created);
    out.extend(v.local);
    out.extend(&v.trailing);
    Ok(out)
}
fn read_i32(c: &mut Cursor<&[u8]>) -> Result<i32, String> {
    let mut b = [0; 4];
    c.read_exact(&mut b).map_err(|e| e.to_string())?;
    Ok(i32::from_le_bytes(b))
}
fn read_fstring(c: &mut Cursor<&[u8]>) -> Result<String, String> {
    let n = read_i32(c)?;
    if n == 0 {
        return Ok(String::new());
    }
    if n > 0 {
        let mut b = vec![0; n as usize];
        c.read_exact(&mut b).map_err(|e| e.to_string())?;
        if b.last() == Some(&0) {
            b.pop();
        }
        String::from_utf8(b).map_err(|e| e.to_string())
    } else {
        let count = n.checked_abs().ok_or("invalid FString length")? as usize;
        let mut b = vec![0; count * 2];
        c.read_exact(&mut b).map_err(|e| e.to_string())?;
        let mut units = b
            .chunks_exact(2)
            .map(|v| u16::from_le_bytes([v[0], v[1]]))
            .collect::<Vec<_>>();
        if units.last() == Some(&0) {
            units.pop();
        }
        String::from_utf16(&units).map_err(|e| e.to_string())
    }
}
fn write_fstring(out: &mut Vec<u8>, v: &str) -> Result<(), String> {
    if v.is_empty() {
        out.extend((0i32).to_le_bytes());
    } else if v.is_ascii() {
        let n = i32::try_from(v.len() + 1).map_err(|e| e.to_string())?;
        out.extend(n.to_le_bytes());
        out.extend(v.as_bytes());
        out.push(0);
    } else {
        let u = v.encode_utf16().collect::<Vec<_>>();
        let n = i32::try_from(u.len() + 1).map_err(|e| e.to_string())?;
        out.extend((-n).to_le_bytes());
        for x in u {
            out.extend(x.to_le_bytes());
        }
        out.extend((0u16).to_le_bytes());
    }
    Ok(())
}
fn slot_properties(v: &StructValue) -> Option<&Properties> {
    match v {
        StructValue::Struct(p) => Some(p),
        _ => None,
    }
}
fn raw_bytes(p: &Property) -> Option<&[u8]> {
    match p {
        Property::Array(uesave::ValueVec::Byte(uesave::ByteArray::Byte(v))) => Some(v),
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
    request: &UpdateSlotRequest
) -> Result<InventorySlot, String> {
    if request.item_id.is_none() && request.quantity.is_none() {
        return Err("itemId or quantity must be supplied".into());
    }
    if request.quantity.is_some_and(|v| v < 0) {
        return Err("quantity must not be negative".into());
    }
    if request.item_id.as_ref().is_some_and(|v| v.chars().count() > 128) {
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
        Some(Property::Array(uesave::ValueVec::Struct(v))) => v,
        _ => {
            return Err("container Slots has an unsupported type".into());
        }
    };
    let original = slots.get(index).ok_or("slot index is out of range")?.clone();
    let mut updated = original.clone();
    let props = slot_properties_mut(&mut updated).ok_or("slot is unsupported")?;
    let raw = match exact_mut(props, "RawData") {
        Some(Property::Array(uesave::ValueVec::Byte(uesave::ByteArray::Byte(v)))) => v,
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
            return Err(
                "itemId changes for dynamic equipment require DynamicItemSaveData synchronization and are not supported yet".into()
            );
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
    let world = exact_mut(&mut save.root.properties, "worldSaveData").and_then(
        struct_properties_mut
    )?;
    match exact_mut(world, "ItemContainerSaveData")? {
        Property::Map(v) => Some(v),
        _ => None,
    }
}
fn exact_mut<'a>(p: &'a mut Properties, name: &str) -> Option<&'a mut Property> {
    p.0.get_mut(&PropertyKey(0, name.to_string()))
}
fn struct_properties_mut(property: &mut Property) -> Option<&mut Properties> {
    match property {
        Property::Struct(StructValue::Struct(v)) => Some(v),
        _ => None,
    }
}
fn slot_properties_mut(v: &mut StructValue) -> Option<&mut Properties> {
    match v {
        StructValue::Struct(p) => Some(p),
        _ => None,
    }
}

pub fn guild_containers(level: &Save, owner: &PlayerInventoryOwner) -> Vec<InventoryContainer> {
    let Some(guild_id) = guild_id_for_player(level, &owner.player_uid) else {
        return Vec::new();
    };
    let Some(map) = item_container_map(level) else {
        return Vec::new();
    };
    map.iter()
        .filter(|entry| {
            struct_properties(&entry.value)
                .and_then(|v| exact(v, "BelongInfo"))
                .and_then(struct_properties)
                .and_then(|v| exact(v, "GroupId"))
                .and_then(crate::pals::as_uuid_string)
                .is_some_and(|v| v.eq_ignore_ascii_case(&guild_id))
        })
        .filter_map(|entry| container_from_entry(level, "GuildChest", entry))
        .collect()
}
fn container_from_entry(
    level: &Save,
    kind: &str,
    entry: &uesave::MapEntry
) -> Option<InventoryContainer> {
    let id = container_id(&entry.key)?;
    let value = struct_properties(&entry.value)?;
    let slots = match exact(value, "Slots") {
        Some(Property::Array(uesave::ValueVec::Struct(values))) =>
            values
                .iter()
                .enumerate()
                .map(|(i, v)| slot_summary(&level.header, i, v))
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
        Property::Map(v) => v,
        _ => {
            return None;
        }
    };
    for entry in groups {
        let value = struct_properties(&entry.value)?;
        let group_type = exact(value, "GroupType").and_then(crate::pals::as_string)?;
        if group_type != "EPalGroupType::Guild" {
            continue;
        }
        let raw = exact(value, "RawData").and_then(raw_bytes)?;
        if
            let Ok((group_id, members)) = decode_group_members(raw) &&
            members.iter().any(|v| v.eq_ignore_ascii_case(player_uid))
        {
            return Some(group_id);
        }
    }
    None
}
fn decode_group_members(raw: &[u8]) -> Result<(String, Vec<String>), String> {
    let mut c = Cursor::new(raw);
    let group = read_guid(&mut c)?;
    let _ = read_fstring(&mut c)?;
    let count = read_i32(&mut c)?;
    if !(0..=100_000).contains(&count) {
        return Err("invalid group member count".into());
    }
    let mut members = Vec::new();
    for _ in 0..count {
        members.push(read_guid(&mut c)?);
        let _ = read_guid(&mut c)?;
    }
    Ok((group, members))
}
fn read_guid(c: &mut Cursor<&[u8]>) -> Result<String, String> {
    let mut b = [0; 16];
    c.read_exact(&mut b).map_err(|e| e.to_string())?;
    let g = uesave::FGuid::new(
        u32::from_le_bytes(b[0..4].try_into().unwrap()),
        u32::from_le_bytes(b[4..8].try_into().unwrap()),
        u32::from_le_bytes(b[8..12].try_into().unwrap()),
        u32::from_le_bytes(b[12..16].try_into().unwrap())
    );
    Ok(g.to_string())
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
}
