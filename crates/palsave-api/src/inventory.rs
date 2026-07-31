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
    /// Position in the stored `Slots` array. Slots are addressed by this.
    pub index: usize,
    /// The in-game slot this entry occupies, from the slot's own raw data.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot_index: Option<i32>,
    pub item_id: Option<String>,
    pub quantity: Option<i32>,
    pub editable: bool,
    /// True when the item carries a `DynamicItemSaveData` id — durability,
    /// ammo and passives live there, so its item id cannot simply be swapped.
    pub dynamic: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryContainer {
    pub kind: String,
    pub container_id: String,
    /// `SlotNum`: how many slots the game gives this container. Only occupied
    /// slots are stored, so `slots.len()` is the used count, not the size.
    pub capacity: i32,
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
                        .map(|(index, slot)| slot_summary(index, slot))
                        .collect(),
                _ => Vec::new(),
            };

            Some(InventoryContainer {
                kind: reference.kind.clone(),
                container_id: reference.container_id.clone(),
                capacity: slot_capacity(value),
                slots,
            })
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownItem {
    pub item_id: String,
    /// How many slots across the world hold this item.
    pub stacks: usize,
    pub total_quantity: i64,
    /// True when the world holds a `DynamicItemSaveData` record for it, which
    /// is what lets a new copy carry durability, ammo and passives.
    pub has_dynamic_template: bool,
}

/// Every item id the world actually contains — chests, bases and players
/// alike. Typing an id the game does not know produces a dead slot, so the
/// editor offers these rather than a guessed list.
pub fn known_items(save: &Save) -> Vec<KnownItem> {
    let mut totals: std::collections::BTreeMap<String, (usize, i64)> = Default::default();

    if let Some(map) = item_container_map(save) {
        for entry in map {
            let Some(container) = struct_properties(&entry.value) else {
                continue;
            };

            let Some(Property::Array(uesave::ValueVec::Struct(slots))) = exact(
                container,
                "Slots"
            ) else {
                continue;
            };

            for slot in slots {
                let Some(data) = slot_properties(slot)
                    .and_then(|properties| exact(properties, "RawData"))
                    .and_then(raw_bytes)
                    .and_then(|bytes| decode_slot(bytes).ok()) else {
                    continue;
                };

                if data.item_id.is_empty() {
                    continue;
                }

                let total = totals.entry(data.item_id).or_default();
                total.0 += 1;
                total.1 += i64::from(data.count);
            }
        }
    }

    let templates = dynamic_item_array(save)
        .map(|entries| {
            entries.iter().filter_map(dynamic_item_id).collect::<std::collections::BTreeSet<_>>()
        })
        .unwrap_or_default();

    let mut items = totals
        .into_iter()
        .map(|(item_id, (stacks, total_quantity))| KnownItem {
            has_dynamic_template: templates.contains(&item_id),
            item_id,
            stacks,
            total_quantity,
        })
        .collect::<Vec<_>>();

    // Commonest first: the item you are looking for is usually a staple.
    items.sort_by(|a, b| { b.stacks.cmp(&a.stacks).then_with(|| a.item_id.cmp(&b.item_id)) });

    items
}

fn item_container_map(save: &Save) -> Option<&Vec<uesave::MapEntry>> {
    let world = exact(&save.root.properties, "worldSaveData").and_then(struct_properties)?;

    match exact(world, "ItemContainerSaveData")? {
        Property::Map(value) => Some(value),
        _ => None,
    }
}

fn slot_capacity(container: &Properties) -> i32 {
    match exact(container, "SlotNum") {
        Some(Property::Int(value)) => *value,
        _ => 0,
    }
}

fn slot_summary(index: usize, slot: &StructValue) -> InventorySlot {
    let data = slot_properties(slot)
        .and_then(|properties| exact(properties, "RawData"))
        .and_then(raw_bytes)
        .and_then(|bytes| decode_slot(bytes).ok());

    InventorySlot {
        index,
        slot_index: data.as_ref().map(|value| value.slot_index),
        item_id: data.as_ref().map(|value| value.item_id.clone()),
        quantity: data.as_ref().map(|value| value.count),
        editable: data.is_some(),
        dynamic: data
            .as_ref()
            .is_some_and(|value| value.created != [0; 16] || value.local != [0; 16] ),
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

impl SlotData {
    /// Whether the slot points at a `DynamicItemSaveData` record.
    fn is_dynamic(&self) -> bool {
        self.created != [0; 16] || self.local != [0; 16]
    }
}

fn decode_slot(bytes: &[u8]) -> Result<SlotData, String> {
    let mut cursor = Cursor::new(bytes);

    let slot_index = read_i32(&mut cursor)?;
    let count = read_i32(&mut cursor)?;
    let item_id = read_fstring(&mut cursor)?;

    let mut created = [0; 16];
    let mut local = [0; 16];

    cursor.read_exact(&mut created).map_err(|error| error.to_string())?;

    cursor.read_exact(&mut local).map_err(|error| error.to_string())?;

    let mut trailing = Vec::new();

    cursor.read_to_end(&mut trailing).map_err(|error| error.to_string())?;

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

    cursor.read_exact(&mut bytes).map_err(|error| error.to_string())?;

    Ok(i32::from_le_bytes(bytes))
}

fn read_fstring(cursor: &mut Cursor<&[u8]>) -> Result<String, String> {
    let length = read_i32(cursor)?;

    if length == 0 {
        return Ok(String::new());
    }

    if length > 0 {
        let mut bytes = vec![0; length as usize];

        cursor.read_exact(&mut bytes).map_err(|error| error.to_string())?;

        if bytes.last() == Some(&0) {
            bytes.pop();
        }

        String::from_utf8(bytes).map_err(|error| error.to_string())
    } else {
        let count = length.checked_abs().ok_or("invalid FString length")? as usize;

        let mut bytes = vec![0; count * 2];

        cursor.read_exact(&mut bytes).map_err(|error| error.to_string())?;

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

    if request.quantity.is_some_and(|value| value < 0) {
        return Err("quantity must not be negative".into());
    }

    if request.item_id.as_deref() == Some("") {
        // A save never stores an empty slot: emptying one means dropping the
        // entry, which is what the slot's DELETE route does.
        return Err("itemId must not be empty — delete the slot to clear it".into());
    }

    if request.item_id.as_ref().is_some_and(|value| value.chars().count() > 128) {
        return Err("itemId must contain at most 128 characters".into());
    }

    let slots = container_slots_mut(save, container_id_value)?;

    let original = slots.get(index).ok_or("slot index is out of range")?.clone();

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
        if *item_id != decoded.item_id && decoded.is_dynamic() {
            return Err(
                "itemId changes for dynamic equipment \
                 require DynamicItemSaveData \
                 synchronization and are not supported yet".into()
            );
        }

        decoded.item_id = item_id.clone();
    }

    let encoded = encode_slot(&decoded)?;
    let verified = decode_slot(&encoded)?;

    *raw = encoded;
    slots[index] = updated;

    Ok(InventorySlot {
        index,
        slot_index: Some(verified.slot_index),
        quantity: Some(verified.count),
        editable: true,
        dynamic: verified.is_dynamic(),
        item_id: Some(verified.item_id),
    })
}

/// Removes a slot entry, which is how the save represents an emptied slot.
pub fn remove_slot(
    save: &mut Save,
    container_id_value: &str,
    index: usize
) -> Result<InventorySlot, String> {
    let slots = container_slots_mut(save, container_id_value)?;

    if index >= slots.len() {
        return Err("slot index is out of range".into());
    }

    let removed = slots.remove(index);

    Ok(slot_summary(index, &removed))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddItemRequest {
    pub expected_revision: u64,

    pub item_id: String,
    pub quantity: i32,
    /// In-game slot to occupy. Defaults to the lowest free one.
    pub slot_index: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddedItem {
    pub slot: InventorySlot,
    /// Set when the new item was given a copy of an existing item's
    /// `DynamicItemSaveData` record (durability, ammo, passive skills).
    pub dynamic_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

/// Appends an item to a container. `kind` is the container's role, used only to
/// warn about equipment that the game expects to carry dynamic item data.
pub fn add_item(
    save: &mut Save,
    container_id_value: &str,
    kind: &str,
    request: &AddItemRequest
) -> Result<AddedItem, String> {
    let item_id = request.item_id.trim();

    if item_id.is_empty() {
        return Err("itemId must not be empty".into());
    }

    if item_id.chars().count() > 128 {
        return Err("itemId must contain at most 128 characters".into());
    }

    if request.quantity < 1 {
        return Err("quantity must be at least 1".into());
    }

    let (template, capacity, occupied) = container_template(save, container_id_value)?;

    if capacity < 1 {
        return Err("this container reports no slot capacity".into());
    }

    let slot_index = match request.slot_index {
        Some(requested) => {
            if requested < 0 || requested >= capacity {
                return Err(format!("slotIndex must be between 0 and {}", capacity - 1));
            }

            if occupied.contains(&requested) {
                return Err(format!("slot {requested} is already occupied"));
            }

            requested
        }
        None =>
            (0..capacity)
                .find(|candidate| !occupied.contains(candidate))
                .ok_or("the container is full")?,
    };

    // Equipment keeps durability, ammo and passives in a separate world record.
    // Cloning the record of an item the save already holds is the only way to
    // mint one that the game will read back correctly.
    let dynamic = clone_dynamic_item(save, item_id)?;

    let dynamic_source = dynamic.as_ref().map(|value| value.item_id.clone());

    let warning = if dynamic.is_none() && is_equipment_container(kind) {
        Some(
            format!(
                "{item_id} was added without dynamic item data because this save \
             holds no other {item_id}; the game may show it with no durability."
            )
        )
    } else {
        None
    };

    let ids = dynamic.as_ref().map(|value| (value.created, value.local));

    let slot = build_slot(&template, slot_index, request.quantity, item_id, ids)?;

    if let Some(dynamic) = dynamic {
        push_dynamic_item(save, dynamic.entry)?;
    }

    let slots = container_slots_mut(save, container_id_value)?;

    // Keep the array ordered by in-game slot, the way the game writes it.
    let index = slots
        .iter()
        .position(|value| slot_order(value).is_some_and(|value| value > slot_index))
        .unwrap_or(slots.len());

    slots.insert(index, slot);

    Ok(AddedItem {
        slot: slot_summary(index, &slots[index]),
        dynamic_source,
        warning,
    })
}

fn is_equipment_container(kind: &str) -> bool {
    matches!(kind, "WeaponLoadOutContainerId" | "PlayerEquipArmorContainerId")
}

fn slot_order(slot: &StructValue) -> Option<i32> {
    slot_properties(slot)
        .and_then(|properties| exact(properties, "RawData"))
        .and_then(raw_bytes)
        .and_then(|bytes| decode_slot(bytes).ok())
        .map(|value| value.slot_index)
}

/// The slot struct to copy for a new entry, plus the container's capacity and
/// the in-game slots it already uses.
fn container_template(
    save: &Save,
    container_id_value: &str
) -> Result<(StructValue, i32, Vec<i32>), String> {
    let map = item_container_map(save).ok_or("ItemContainerSaveData is unavailable")?;

    let container = map
        .iter()
        .find(|entry| {
            container_id(&entry.key).is_some_and(|id| id.eq_ignore_ascii_case(container_id_value))
        })
        .and_then(|entry| struct_properties(&entry.value))
        .ok_or("container was not found")?;

    let slots = match exact(container, "Slots") {
        Some(Property::Array(uesave::ValueVec::Struct(values))) => values.as_slice(),
        _ => {
            return Err("container Slots has an unsupported type".into());
        }
    };

    let occupied = slots.iter().filter_map(slot_order).collect::<Vec<_>>();

    // Slot structs carry version bytes alongside the item payload, so a new one
    // is always cloned from a real slot — this container's if it has any, else
    // any other container in the same save.
    let template = slots
        .iter()
        .find(|slot| slot_order(slot).is_some())
        .or_else(|| {
            map.iter()
                .filter_map(|entry| struct_properties(&entry.value))
                .filter_map(|value| {
                    match exact(value, "Slots") {
                        Some(Property::Array(uesave::ValueVec::Struct(values))) => Some(values),
                        _ => None,
                    }
                })
                .flatten()
                .find(|slot| slot_order(slot).is_some())
        })
        .ok_or("this save holds no readable item slot to model a new one on")?
        .clone();

    Ok((template, slot_capacity(container), occupied))
}

fn build_slot(
    template: &StructValue,
    slot_index: i32,
    quantity: i32,
    item_id: &str,
    dynamic: Option<([u8; 16], [u8; 16])>
) -> Result<StructValue, String> {
    let mut value = template.clone();

    let properties = slot_properties_mut(&mut value).ok_or("slot template is unsupported")?;

    let raw = match exact_mut(properties, "RawData") {
        Some(Property::Array(uesave::ValueVec::Byte(uesave::ByteArray::Byte(value)))) => value,
        _ => {
            return Err("slot template RawData is unsupported".into());
        }
    };

    let mut decoded = decode_slot(raw)?;

    decoded.slot_index = slot_index;
    decoded.count = quantity;
    decoded.item_id = item_id.to_string();

    let (created, local) = dynamic.unwrap_or(([0; 16], [0; 16]));

    decoded.created = created;
    decoded.local = local;
    // The tail holds the template item's own state; a fresh stack starts blank,
    // which is exactly how the game writes plain items.
    decoded.trailing = vec![0; decoded.trailing.len()];

    let encoded = encode_slot(&decoded)?;

    decode_slot(&encoded)?;

    *raw = encoded;

    Ok(value)
}

struct ClonedDynamicItem {
    entry: StructValue,
    item_id: String,
    created: [u8; 16],
    local: [u8; 16],
}

/// Copies an existing `DynamicItemSaveData` record for `item_id` under a fresh
/// id, so the new stack owns its state instead of sharing the original's.
fn clone_dynamic_item(save: &Save, item_id: &str) -> Result<Option<ClonedDynamicItem>, String> {
    let Some(entries) = dynamic_item_array(save) else {
        return Ok(None);
    };

    let Some(source) = entries
        .iter()
        .find(|entry| dynamic_item_id(entry).is_some_and(|id| id == item_id)) else {
        return Ok(None);
    };

    let mut entry = source.clone();

    let properties = slot_properties_mut(&mut entry).ok_or("dynamic item record is unsupported")?;

    let raw = match exact_mut(properties, "RawData") {
        Some(Property::Array(uesave::ValueVec::Byte(uesave::ByteArray::Byte(value)))) => value,
        _ => {
            return Err("dynamic item RawData is unsupported".into());
        }
    };

    if raw.len() < 32 {
        return Err("dynamic item RawData is too short".into());
    }

    let mut created = [0; 16];
    let mut local = [0; 16];

    created.copy_from_slice(&raw[..16]);
    local.copy_from_slice(uuid::Uuid::new_v4().as_bytes());

    raw[16..32].copy_from_slice(&local);

    Ok(
        Some(ClonedDynamicItem {
            entry,
            item_id: item_id.to_string(),
            created,
            local,
        })
    )
}

fn push_dynamic_item(save: &mut Save, entry: StructValue) -> Result<(), String> {
    let world = exact_mut(&mut save.root.properties, "worldSaveData")
        .and_then(struct_properties_mut)
        .ok_or("worldSaveData is unavailable")?;

    match exact_mut(world, "DynamicItemSaveData") {
        Some(Property::Array(uesave::ValueVec::Struct(values))) => {
            values.push(entry);
            Ok(())
        }
        _ => Err("DynamicItemSaveData is unavailable".into()),
    }
}

fn dynamic_item_array(save: &Save) -> Option<&Vec<StructValue>> {
    let world = exact(&save.root.properties, "worldSaveData").and_then(struct_properties)?;

    match exact(world, "DynamicItemSaveData")? {
        Property::Array(uesave::ValueVec::Struct(values)) => Some(values),
        _ => None,
    }
}

/// The static item id inside a dynamic item record: two ids then an FString.
fn dynamic_item_id(entry: &StructValue) -> Option<String> {
    let bytes = slot_properties(entry)
        .and_then(|properties| exact(properties, "RawData"))
        .and_then(raw_bytes)?;

    let mut cursor = Cursor::new(bytes.get(32..)?);

    read_fstring(&mut cursor).ok()
}

fn container_slots_mut<'a>(
    save: &'a mut Save,
    container_id_value: &str
) -> Result<&'a mut Vec<StructValue>, String> {
    let map = item_container_map_mut(save).ok_or("ItemContainerSaveData is unavailable")?;

    let entry = map
        .iter_mut()
        .find(|entry| {
            container_id(&entry.key).is_some_and(|id| id.eq_ignore_ascii_case(container_id_value))
        })
        .ok_or("container was not found")?;

    let value = struct_properties_mut(&mut entry.value).ok_or("container value is unsupported")?;

    match exact_mut(value, "Slots") {
        Some(Property::Array(uesave::ValueVec::Struct(values))) => Ok(values),
        _ => Err("container Slots has an unsupported type".into()),
    }
}

fn item_container_map_mut(save: &mut Save) -> Option<&mut Vec<uesave::MapEntry>> {
    let world = exact_mut(&mut save.root.properties, "worldSaveData").and_then(
        struct_properties_mut
    )?;

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

#[cfg(test)]
mod container_tests {
    use super::*;
    use serde_json::json;
    use uesave::{ FGuid, MapEntry, PropertySchemas, Root };

    const CONTAINER: &str = "11111111-2222-3333-4444-555555555555";
    const VERSION_BYTES: [u8; 4] = [1, 0, 0, 0];

    fn slot(slot_index: i32, count: i32, item_id: &str, local: [u8; 16]) -> StructValue {
        let raw = encode_slot(
            &(SlotData {
                slot_index,
                count,
                item_id: item_id.into(),
                created: [0; 16],
                local,
                trailing: vec![0; 20],
            })
        ).expect("encode slot");

        let mut properties = Properties::default();
        properties.insert("RawData", byte_array(raw));
        properties.insert("CustomVersionData", byte_array(VERSION_BYTES.to_vec()));
        StructValue::Struct(properties)
    }

    fn dynamic_item(item_id: &str, local: [u8; 16], durability: f32) -> StructValue {
        let mut raw = vec![0_u8; 16];
        raw.extend(local);
        write_fstring(&mut raw, item_id).expect("write item id");
        raw.extend(durability.to_le_bytes());

        let mut properties = Properties::default();
        properties.insert("RawData", byte_array(raw));
        StructValue::Struct(properties)
    }

    fn byte_array(bytes: Vec<u8>) -> Property {
        Property::Array(uesave::ValueVec::Byte(uesave::ByteArray::Byte(bytes)))
    }

    fn save_with(slots: Vec<StructValue>, capacity: i32, dynamic: Vec<StructValue>) -> Save {
        let mut key = Properties::default();
        key.insert("ID", Property::Struct(StructValue::Guid(FGuid::parse_str(CONTAINER).unwrap())));

        let mut container = Properties::default();
        container.insert("Slots", Property::Array(uesave::ValueVec::Struct(slots)));
        container.insert("SlotNum", Property::Int(capacity));

        let mut world = Properties::default();
        world.insert(
            "ItemContainerSaveData",
            Property::Map(
                vec![MapEntry {
                    key: Property::Struct(StructValue::Struct(key)),
                    value: Property::Struct(StructValue::Struct(container)),
                }]
            )
        );
        world.insert("DynamicItemSaveData", Property::Array(uesave::ValueVec::Struct(dynamic)));

        let mut root = Properties::default();
        root.insert("worldSaveData", Property::Struct(StructValue::Struct(world)));

        Save {
            header: serde_json
                ::from_value(
                    json!({
                "magic": u32::from_le_bytes(*b"GVAS"), "save_game_version": 3,
                "package_version": { "ue4": 522, "ue5": 1009 },
                "engine_version_major": 5, "engine_version_minor": 1, "engine_version_patch": 1,
                "engine_version_build": 0, "engine_version": "test", "custom_version": [0, []]
            })
                )
                .expect("test header"),
            schemas: PropertySchemas::new(),
            root: Root {
                save_game_type: "TestSave".into(),
                properties: root,
            },
            extra: Vec::new(),
        }
    }

    fn add(item_id: &str, quantity: i32, slot_index: Option<i32>) -> AddItemRequest {
        AddItemRequest {
            expected_revision: 0,
            item_id: item_id.into(),
            quantity,
            slot_index,
        }
    }

    fn stored(save: &Save) -> Vec<(i32, String, i32)> {
        let map = item_container_map(save).expect("container map");
        let container = struct_properties(&map[0].value).expect("container");

        match exact(container, "Slots") {
            Some(Property::Array(uesave::ValueVec::Struct(values))) =>
                values
                    .iter()
                    .map(|slot| {
                        let summary = slot_summary(0, slot);
                        (
                            summary.slot_index.unwrap(),
                            summary.item_id.unwrap(),
                            summary.quantity.unwrap(),
                        )
                    })
                    .collect(),
            _ => panic!("slots are missing"),
        }
    }

    #[test]
    fn adding_fills_the_lowest_free_slot_and_keeps_slot_order() {
        let mut save = save_with(
            vec![slot(0, 1, "Wood", [0; 16]), slot(2, 1, "Stone", [0; 16])],
            8,
            Vec::new()
        );

        let added = add_item(
            &mut save,
            CONTAINER,
            "CommonContainerId",
            &add("Fiber", 42, None)
        ).expect("add item");

        assert_eq!(added.slot.slot_index, Some(1));
        assert_eq!(added.slot.index, 1, "new entry sits between slots 0 and 2");
        assert!(added.warning.is_none());
        assert_eq!(added.dynamic_source, None);
        assert_eq!(
            stored(&save),
            vec![(0, "Wood".into(), 1), (1, "Fiber".into(), 42), (2, "Stone".into(), 1)]
        );
    }

    #[test]
    fn adding_honours_a_requested_slot_and_rejects_impossible_ones() {
        let mut save = save_with(vec![slot(0, 1, "Wood", [0; 16])], 3, Vec::new());

        let added = add_item(
            &mut save,
            CONTAINER,
            "EssentialContainerId",
            &add("KeySphere_01", 1, Some(2))
        ).expect("add item");

        assert_eq!(added.slot.slot_index, Some(2));

        assert_eq!(
            add_item(&mut save, CONTAINER, "x", &add("Wood", 1, Some(0))).unwrap_err(),
            "slot 0 is already occupied"
        );
        assert_eq!(
            add_item(&mut save, CONTAINER, "x", &add("Wood", 1, Some(3))).unwrap_err(),
            "slotIndex must be between 0 and 2"
        );
        assert_eq!(
            add_item(&mut save, CONTAINER, "x", &add("Wood", 0, None)).unwrap_err(),
            "quantity must be at least 1"
        );
        assert_eq!(
            add_item(&mut save, CONTAINER, "x", &add("  ", 1, None)).unwrap_err(),
            "itemId must not be empty"
        );

        // Slots 0 and 2 are taken; filling 1 leaves nowhere to go.
        add_item(&mut save, CONTAINER, "x", &add("Stone", 1, None)).expect("add item");
        assert_eq!(
            add_item(&mut save, CONTAINER, "x", &add("Stone", 1, None)).unwrap_err(),
            "the container is full"
        );
    }

    #[test]
    fn adding_equipment_clones_dynamic_item_data_under_a_fresh_id() {
        let original = [7; 16];
        let mut save = save_with(
            vec![slot(0, 1, "Axe_Tier_00", original)],
            4,
            vec![dynamic_item("Axe_Tier_00", original, 80.0)]
        );

        let added = add_item(
            &mut save,
            CONTAINER,
            "WeaponLoadOutContainerId",
            &add("Axe_Tier_00", 1, None)
        ).expect("add item");

        assert_eq!(added.dynamic_source.as_deref(), Some("Axe_Tier_00"));
        assert!(added.slot.dynamic, "the copy carries its own dynamic id");
        assert!(added.warning.is_none());

        let entries = dynamic_item_array(&save).expect("dynamic items");
        assert_eq!(entries.len(), 2, "the record was copied, not shared");

        let copy = raw_of(&entries[1]);
        assert_eq!(&copy[..16], &[0; 16], "created id is preserved");
        assert_ne!(&copy[16..32], &original, "local id is regenerated");
        assert_eq!(
            &copy[32..],
            &raw_of(&entries[0])[32..],
            "durability and the rest of the record are untouched"
        );
    }

    #[test]
    fn adding_unknown_equipment_warns_that_dynamic_data_is_missing() {
        let mut save = save_with(vec![slot(0, 1, "Wood", [0; 16])], 4, Vec::new());

        let added = add_item(
            &mut save,
            CONTAINER,
            "WeaponLoadOutContainerId",
            &add("AssaultRifle_Tier_02", 1, None)
        ).expect("add item");

        assert!(!added.slot.dynamic);
        assert!(
            added.warning.as_deref().is_some_and(|value| value.contains("AssaultRifle_Tier_02")),
            "unexpected warning: {:?}",
            added.warning
        );

        // The same item in a backpack is an ordinary stack, so no warning.
        let plain = add_item(
            &mut save,
            CONTAINER,
            "CommonContainerId",
            &add("AssaultRifle_Tier_02", 1, None)
        ).expect("add item");
        assert!(plain.warning.is_none());
    }

    #[test]
    fn removing_a_slot_drops_the_entry_because_saves_never_store_empty_slots() {
        let mut save = save_with(
            vec![slot(0, 1, "Wood", [0; 16]), slot(3, 5, "Stone", [0; 16])],
            8,
            Vec::new()
        );

        let removed = remove_slot(&mut save, CONTAINER, 0).expect("remove slot");

        assert_eq!(removed.item_id.as_deref(), Some("Wood"));
        assert_eq!(stored(&save), vec![(3, "Stone".into(), 5)]);
        assert_eq!(remove_slot(&mut save, CONTAINER, 1).unwrap_err(), "slot index is out of range");
    }

    #[test]
    fn clearing_through_an_update_is_refused_in_favour_of_deleting() {
        let mut save = save_with(vec![slot(0, 1, "Wood", [0; 16])], 8, Vec::new());

        let request = UpdateSlotRequest {
            expected_revision: 0,
            item_id: Some(String::new()),
            quantity: None,
        };

        assert_eq!(
            update_slot(&mut save, CONTAINER, 0, &request).unwrap_err(),
            "itemId must not be empty — delete the slot to clear it"
        );
    }

    #[test]
    fn updating_reports_the_in_game_slot_rather_than_the_array_position() {
        let mut save = save_with(
            vec![slot(0, 1, "Wood", [0; 16]), slot(6, 1, "Stone", [0; 16])],
            8,
            Vec::new()
        );

        let request = UpdateSlotRequest {
            expected_revision: 0,
            item_id: None,
            quantity: Some(99),
        };

        let updated = update_slot(&mut save, CONTAINER, 1, &request).expect("update");

        assert_eq!(updated.index, 1);
        assert_eq!(updated.slot_index, Some(6));
        assert_eq!(updated.quantity, Some(99));
    }

    #[test]
    fn containers_report_capacity_alongside_the_slots_they_store() {
        let save = save_with(vec![slot(0, 1, "Wood", [0; 16])], 42, Vec::new());
        let owner = PlayerInventoryOwner {
            player_uid: "player".into(),
            file_name: "player.sav".into(),
            nickname: None,
            personal_containers: vec![ContainerReference {
                kind: "CommonContainerId".into(),
                container_id: CONTAINER.into(),
            }],
        };

        let containers = personal_containers(&save, &owner);

        assert_eq!(containers.len(), 1);
        assert_eq!(containers[0].capacity, 42);
        assert_eq!(containers[0].slots.len(), 1);
    }

    fn raw_of(entry: &StructValue) -> Vec<u8> {
        slot_properties(entry)
            .and_then(|properties| exact(properties, "RawData"))
            .and_then(raw_bytes)
            .expect("raw data")
            .to_vec()
    }
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
