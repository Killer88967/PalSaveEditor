//! Aggregate statistics for a loaded save.
//!
//! The editor's dashboard needs a single cheap request that answers "what is in
//! this world?" — engine metadata, how large each `worldSaveData` collection is,
//! and a digest of the character map. Everything here is derived from data the
//! session already holds, so no extra parsing happens.

use std::collections::HashMap;

use serde::Serialize;
use uesave::{ Property, Save };

use crate::inventory::PlayerSaveFile;
use crate::pals::{ PalIndexCache, PalParseStatus, as_struct_properties, property_by_name };

/// Species and player rows shown in the dashboard's leaderboards.
const HIGHLIGHT_LIMIT: usize = 8;
const SPECIES_LIMIT: usize = 12;

/// Level ranges used for the distribution chart, as `(label, inclusive max)`.
const LEVEL_BUCKETS: [(&str, i32); 6] = [
    ("1–10", 10),
    ("11–20", 20),
    ("21–30", 30),
    ("31–40", 40),
    ("41–50", 50),
    ("51+", i32::MAX),
];

const WORLD: &str = "worldSaveData";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOverview {
    pub save_game_type: String,
    pub engine_version: String,
    pub save_game_version: u32,
    pub root_property_count: usize,
    pub world_collections: Vec<CollectionSummary>,
    pub characters: CharacterStats,
    pub top_species: Vec<SpeciesCount>,
    pub level_histogram: Vec<LevelBucket>,
    pub strongest: Vec<PalHighlight>,
    pub players: Vec<PlayerOverview>,
}

/// One immediate child of `worldSaveData`, with the size of whatever it holds.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionSummary {
    pub name: String,
    /// `"map"`, `"array"`, `"struct"`, `"raw"` or `"scalar"`.
    pub kind: &'static str,
    /// Entries for maps/arrays/structs, `None` for scalars.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_count: Option<usize>,
    /// Byte length for collections the parser left as raw bytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_length: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterStats {
    pub total: usize,
    pub pals: usize,
    pub players: usize,
    pub nicknamed: usize,
    pub complete: usize,
    pub partial: usize,
    pub unsupported: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub average_pal_level: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_pal_level: Option<i32>,
    pub distinct_species: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeciesCount {
    pub character_id: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelBucket {
    pub label: &'static str,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PalHighlight {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub character_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerOverview {
    pub player_uid: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<i32>,
    pub pal_count: usize,
    /// True when the matching `<uid>.sav` was uploaded alongside `Level.sav`.
    pub has_save_file: bool,
}

/// Builds the dashboard payload from the cached Pal index and the level save.
pub fn build(save: &Save, index: &PalIndexCache, player_saves: &[PlayerSaveFile]) -> SaveOverview {
    let world_collections = world_collections(save);
    let characters = character_stats(index);

    SaveOverview {
        save_game_type: save.root.save_game_type.clone(),
        engine_version: engine_version(save),
        save_game_version: save.header.save_game_version,
        root_property_count: save.root.properties.0.len(),
        world_collections,
        characters,
        top_species: top_species(index),
        level_histogram: level_histogram(index),
        strongest: strongest(index),
        players: players(save, index, player_saves),
    }
}

fn engine_version(save: &Save) -> String {
    let header = &save.header;

    format!(
        "{}.{}.{} build {}",
        header.engine_version_major,
        header.engine_version_minor,
        header.engine_version_patch,
        header.engine_version_build
    )
}

fn world_collections(save: &Save) -> Vec<CollectionSummary> {
    let Some(world) = property_by_name(&save.root.properties, WORLD).and_then(
        as_struct_properties
    ) else {
        return Vec::new();
    };

    let mut collections: Vec<_> = world.0
        .iter()
        .map(|(key, property)| collection_summary(key.1.clone(), property))
        .collect();

    // Largest collections first — that is what a user scanning the table wants.
    collections.sort_by(|a, b| {
        b.entry_count
            .unwrap_or(0)
            .cmp(&a.entry_count.unwrap_or(0))
            .then_with(|| b.byte_length.unwrap_or(0).cmp(&a.byte_length.unwrap_or(0)))
            .then_with(|| a.name.cmp(&b.name))
    });

    collections
}

fn collection_summary(name: String, property: &Property) -> CollectionSummary {
    let (kind, entry_count, byte_length) = match property {
        Property::Map(entries) => ("map", Some(entries.len()), None),
        Property::Array(values) | Property::Set(values) => {
            ("array", Some(crate::nodes::value_vec_len(values)), None)
        }
        // Struct values that are not plain property bags (vectors, GUIDs, …)
        // have no child count to report.
        Property::Struct(_) =>
            ("struct", as_struct_properties(property).map(|properties| properties.0.len()), None),
        Property::Raw(bytes) => ("raw", None, Some(bytes.len())),
        _ => ("scalar", None, None),
    };

    CollectionSummary {
        name,
        kind,
        entry_count,
        byte_length,
    }
}

fn character_stats(index: &PalIndexCache) -> CharacterStats {
    let mut stats = CharacterStats {
        total: index.items.len(),
        pals: 0,
        players: 0,
        nicknamed: 0,
        complete: 0,
        partial: 0,
        unsupported: 0,
        average_pal_level: None,
        max_pal_level: None,
        distinct_species: 0,
    };

    let mut level_total = 0_i64;
    let mut level_count = 0_usize;
    let mut species = HashMap::new();

    for item in &index.items {
        if item.is_player {
            stats.players += 1;
        } else {
            stats.pals += 1;
            if let Some(id) = &item.character_id {
                *species.entry(id.as_str()).or_insert(0_usize) += 1;
            }
            if let Some(level) = item.level {
                level_total += i64::from(level);
                level_count += 1;
                stats.max_pal_level = Some(
                    stats.max_pal_level.map_or(level, |m: i32| m.max(level))
                );
            }
        }

        if item.nickname.is_some() {
            stats.nicknamed += 1;
        }

        match item.parse_status {
            PalParseStatus::Complete => {
                stats.complete += 1;
            }
            PalParseStatus::Partial => {
                stats.partial += 1;
            }
            PalParseStatus::Unsupported => {
                stats.unsupported += 1;
            }
        }
    }

    stats.distinct_species = species.len();
    if level_count > 0 {
        stats.average_pal_level = Some((level_total as f64) / (level_count as f64));
    }

    stats
}

fn top_species(index: &PalIndexCache) -> Vec<SpeciesCount> {
    let mut counts: HashMap<&str, usize> = HashMap::new();

    for item in index.items.iter().filter(|item| !item.is_player) {
        if let Some(id) = &item.character_id {
            *counts.entry(id.as_str()).or_insert(0) += 1;
        }
    }

    let mut ranked: Vec<_> = counts
        .into_iter()
        .map(|(character_id, count)| SpeciesCount {
            character_id: character_id.to_string(),
            count,
        })
        .collect();

    ranked.sort_by(|a, b| {
        b.count.cmp(&a.count).then_with(|| a.character_id.cmp(&b.character_id))
    });
    ranked.truncate(SPECIES_LIMIT);
    ranked
}

fn level_histogram(index: &PalIndexCache) -> Vec<LevelBucket> {
    let mut buckets: Vec<LevelBucket> = LEVEL_BUCKETS.iter()
        .map(|(label, _)| LevelBucket { label, count: 0 })
        .collect();

    for item in index.items.iter().filter(|item| !item.is_player) {
        let Some(level) = item.level else {
            continue;
        };
        let slot = LEVEL_BUCKETS.iter()
            .position(|(_, max)| level <= *max)
            .unwrap_or(LEVEL_BUCKETS.len() - 1);
        buckets[slot].count += 1;
    }

    buckets
}

fn strongest(index: &PalIndexCache) -> Vec<PalHighlight> {
    let mut ranked: Vec<_> = index.items
        .iter()
        .filter(|item| !item.is_player && item.level.is_some())
        .collect();

    ranked.sort_by(|a, b| {
        b.level
            .cmp(&a.level)
            .then_with(|| b.rank.cmp(&a.rank))
            .then_with(|| a.id.cmp(&b.id))
    });

    ranked
        .into_iter()
        .take(HIGHLIGHT_LIMIT)
        .map(|item| PalHighlight {
            id: item.id.clone(),
            nickname: item.nickname.clone(),
            character_id: item.character_id.clone(),
            level: item.level,
            rank: item.rank,
        })
        .collect()
}

fn players(
    save: &Save,
    index: &PalIndexCache,
    player_saves: &[PlayerSaveFile]
) -> Vec<PlayerOverview> {
    let mut owned: HashMap<String, usize> = HashMap::new();

    for item in index.items.iter().filter(|item| !item.is_player) {
        if let Some(uid) = &item.owner_player_uid {
            *owned.entry(uid.to_ascii_lowercase()).or_insert(0) += 1;
        }
    }

    let uploaded: Vec<String> = player_saves
        .iter()
        .map(|file| file.file_name.to_ascii_lowercase())
        .collect();

    let mut players: Vec<_> = index.items
        .iter()
        .filter(|item| item.is_player)
        .map(|item| {
            // A player row carries its identity in the map key's `PlayerUId`;
            // `OwnerPlayerUId` is only populated on the Pals it captured.
            let uid = item.player_uid
                .clone()
                .or_else(|| item.owner_player_uid.clone())
                .unwrap_or_default();
            let key = uid.to_ascii_lowercase();
            let compact = key.replace('-', "");

            PlayerOverview {
                nickname: item.nickname
                    .clone()
                    .or_else(|| crate::pals::player_nickname(save, &uid)),
                level: item.level,
                pal_count: owned.get(&key).copied().unwrap_or(0),
                has_save_file: !compact.is_empty() &&
                uploaded.iter().any(|name| name.replace('-', "").contains(&compact)),
                player_uid: uid,
            }
        })
        .collect();

    players.sort_by(|a, b| {
        b.pal_count.cmp(&a.pal_count).then_with(|| a.player_uid.cmp(&b.player_uid))
    });

    players
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pals::PalSummary;
    use serde_json::json;
    use uesave::{ Header, Properties, PropertySchemas, Root, StructValue };

    const OWNER: &str = "aaaaaaaa-0000-0000-0000-000000000001";

    fn pal(index: usize, character: &str, level: Option<i32>, rank: Option<i32>) -> PalSummary {
        PalSummary {
            id: format!("map:{index}"),
            map_index: index,
            instance_id: Some(format!("instance-{index}")),
            character_id: Some(character.to_string()),
            nickname: None,
            level,
            rank,
            gender: Some("Male".into()),
            owner_player_uid: Some(OWNER.to_string()),
            player_uid: None,
            is_player: false,
            parse_status: PalParseStatus::Complete,
            raw_path: Vec::new(),
        }
    }

    fn player(index: usize, nickname: &str) -> PalSummary {
        PalSummary {
            id: format!("map:{index}"),
            map_index: index,
            instance_id: Some(OWNER.to_string()),
            character_id: Some("Player".into()),
            nickname: Some(nickname.to_string()),
            level: Some(30),
            rank: Some(1),
            gender: Some("Female".into()),
            // Players identify themselves through the map key, not the value.
            owner_player_uid: None,
            player_uid: Some(OWNER.to_string()),
            is_player: true,
            parse_status: PalParseStatus::Complete,
            raw_path: Vec::new(),
        }
    }

    fn index() -> PalIndexCache {
        PalIndexCache {
            revision: 7,
            items: vec![
                pal(0, "Lamball", Some(5), Some(1)),
                pal(1, "Lamball", Some(15), Some(2)),
                pal(2, "Lamball", Some(55), Some(5)),
                pal(3, "Frostallion", Some(50), Some(3)),
                // No level at all: counted as a Pal, excluded from averages.
                pal(4, "Jetragon", None, None),
                player(5, "Tester")
            ],
        }
    }

    fn save(world: Option<Properties>) -> Save {
        let header: Header = serde_json
            ::from_value(
                json!({
            "magic": u32::from_le_bytes(*b"GVAS"), "save_game_version": 3,
            "package_version": { "ue4": 522, "ue5": 1009 },
            "engine_version_major": 5, "engine_version_minor": 1, "engine_version_patch": 1,
            "engine_version_build": 42, "engine_version": "test", "custom_version": [0, []]
        })
            )
            .expect("test header");

        let mut root = Properties::default();
        if let Some(world) = world {
            root.insert(WORLD, Property::Struct(StructValue::Struct(world)));
        }

        Save {
            header,
            schemas: PropertySchemas::new(),
            root: Root {
                save_game_type: "TestSave".into(),
                properties: root,
            },
            extra: Vec::new(),
        }
    }

    #[test]
    fn character_stats_separate_players_from_pals_and_skip_unlevelled_pals() {
        let stats = character_stats(&index());

        assert_eq!(stats.total, 6);
        assert_eq!(stats.pals, 5);
        assert_eq!(stats.players, 1);
        assert_eq!(stats.nicknamed, 1);
        assert_eq!(stats.complete, 6);
        assert_eq!(stats.distinct_species, 3);
        assert_eq!(stats.max_pal_level, Some(55));
        // (5 + 15 + 55 + 50) / 4 — the level-less Jetragon is not averaged in.
        assert_eq!(stats.average_pal_level, Some(31.25));
    }

    #[test]
    fn empty_index_reports_no_levels_rather_than_zero() {
        let stats = character_stats(
            &(PalIndexCache {
                revision: 0,
                items: Vec::new(),
            })
        );

        assert_eq!(stats.total, 0);
        assert_eq!(stats.average_pal_level, None);
        assert_eq!(stats.max_pal_level, None);
    }

    #[test]
    fn species_ranking_excludes_players_and_breaks_ties_by_name() {
        let ranked = top_species(&index());

        assert_eq!(ranked[0].character_id, "Lamball");
        assert_eq!(ranked[0].count, 3);
        assert_eq!(ranked[1].character_id, "Frostallion");
        assert_eq!(ranked[2].character_id, "Jetragon");
        assert!(!ranked.iter().any(|entry| entry.character_id == "Player"));
    }

    #[test]
    fn level_histogram_covers_every_bucket_including_the_open_ended_one() {
        let buckets = level_histogram(&index());

        assert_eq!(buckets.len(), LEVEL_BUCKETS.len());
        let counts: Vec<_> = buckets
            .iter()
            .map(|bucket| bucket.count)
            .collect();
        // 5 → "1–10", 15 → "11–20", 50 → "41–50", 55 → "51+".
        assert_eq!(counts, vec![1, 1, 0, 0, 1, 1]);
        assert_eq!(
            buckets
                .iter()
                .map(|bucket| bucket.count)
                .sum::<usize>(),
            4
        );
    }

    #[test]
    fn strongest_ranks_by_level_then_rank_and_skips_players() {
        let ranked = strongest(&index());

        assert_eq!(ranked.len(), 4);
        assert_eq!(ranked[0].level, Some(55));
        assert_eq!(ranked[1].level, Some(50));
        assert!(ranked.iter().all(|entry| entry.level.is_some()));
    }

    #[test]
    fn players_are_matched_to_their_uploaded_save_file_by_uid() {
        let uploaded = [
            PlayerSaveFile {
                file_name: "AAAAAAAA0000000000000000".to_string() + "00000001.sav",
                save: save(None),
            },
        ];

        let rows = players(&save(None), &index(), &uploaded);

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].player_uid, OWNER);
        assert_eq!(rows[0].nickname.as_deref(), Some("Tester"));
        // All five Pals in the fixture are owned by this player.
        assert_eq!(rows[0].pal_count, 5);
        assert!(rows[0].has_save_file);
    }

    #[test]
    fn players_without_a_matching_upload_are_reported_as_level_only() {
        let rows = players(&save(None), &index(), &[]);

        assert_eq!(rows.len(), 1);
        assert!(!rows[0].has_save_file);
        assert_eq!(rows[0].level, Some(30));
    }

    #[test]
    fn world_collections_are_sized_and_sorted_largest_first() {
        let mut world = Properties::default();
        world.insert("CharacterSaveParameterMap", Property::Map(Vec::new()));
        world.insert(
            "GroupSaveDataMap",
            Property::Map(
                vec![
                    uesave::MapEntry {
                        key: Property::Str("a".into()),
                        value: Property::Int(1),
                    },
                    uesave::MapEntry {
                        key: Property::Str("b".into()),
                        value: Property::Int(2),
                    }
                ]
            )
        );
        world.insert("MapObjectSaveData", Property::Raw(vec![0; 64]));
        world.insert("Version", Property::Int(3));

        let collections = world_collections(&save(Some(world)));

        assert_eq!(collections[0].name, "GroupSaveDataMap");
        assert_eq!(collections[0].kind, "map");
        assert_eq!(collections[0].entry_count, Some(2));

        let raw = collections
            .iter()
            .find(|entry| entry.name == "MapObjectSaveData")
            .expect("raw collection");
        assert_eq!(raw.kind, "raw");
        assert_eq!(raw.byte_length, Some(64));
        assert_eq!(raw.entry_count, None);

        let scalar = collections
            .iter()
            .find(|entry| entry.name == "Version")
            .expect("scalar property");
        assert_eq!(scalar.kind, "scalar");
        assert_eq!(scalar.entry_count, None);
    }

    #[test]
    fn a_save_without_world_data_still_builds_an_overview() {
        let built = build(&save(None), &index(), &[]);

        assert!(built.world_collections.is_empty());
        assert_eq!(built.save_game_type, "TestSave");
        assert_eq!(built.engine_version, "5.1.1 build 42");
        assert_eq!(built.save_game_version, 3);
        assert_eq!(built.characters.total, 6);
    }
}
