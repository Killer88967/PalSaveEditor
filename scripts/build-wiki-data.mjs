#!/usr/bin/env node
/**
 * Turns the Palworld game-data dump into the slim JSON the wiki pages read,
 * and copies the icons those pages reference.
 *
 * The dump (`data/json`) is large, localised into a dozen languages and full
 * of fields the wiki never shows, so nothing from it is committed directly.
 * This script writes only what is rendered, into web/public/wiki.
 *
 *   node scripts/build-wiki-data.mjs [--data <dir>] [--assets <dir>]
 *
 * `--assets` points at a directory of `*.webp` icons (Palworld Save Pal keeps
 * them in ui/src/lib/assets/img). Omit it to regenerate the JSON only.
 */

import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const DATA = resolve(ROOT, flag("data", "data/json"));
const ASSETS = flag("assets");
const OUT = resolve(ROOT, "web/public/wiki");

/** Work suitability keys map to icon names that read nothing like them. */
const WORK_ICONS = {
  EmitFlame: "kindling",
  Watering: "watering",
  Seeding: "planting",
  GenerateElectricity: "generating",
  Handcraft: "handiwork",
  Collection: "gathering",
  Deforest: "deforesting",
  Mining: "mining",
  OilExtraction: "extracting",
  ProductMedicine: "production",
  Cool: "cooling",
  Transport: "transporting",
  MonsterFarm: "farming",
};

const icons = new Set();

async function load(name) {
  return JSON.parse(await readFile(join(DATA, name), "utf8"));
}

/** English names and descriptions live beside the numbers, not inside them. */
async function localised(name) {
  const text = await load(`l10n/en/${name}`);
  return (key) => ({
    name: text[key]?.localized_name || key,
    description: text[key]?.description || undefined,
  });
}

/**
 * Pal artwork is keyed by a stripped character id: `Boss_Anubis` and
 * `Anubis_2` are both drawn as `anubis.webp`. Mirrors Save Pal's resolver so
 * the icons that exist are the icons we ask for.
 */
function palIcon(key, isPal) {
  if (!isPal) return "commonhuman";
  return key
    .toLowerCase()
    .replace("predator_", "")
    .replace("_oilrig", "")
    .replace("raid_", "")
    .replace("summon_", "")
    .replace("_max", "")
    .replace(/_\d+$/, "")
    .replace("boss_", "")
    .replace("quest_farmer03_", "")
    .replace("_otomo", "");
}

function icon(name) {
  if (name) icons.add(name);
  return name;
}

async function pals() {
  const raw = await load("pals.json");
  const text = await localised("pals.json");

  return Object.entries(raw)
    .filter(([, pal]) => !pal.disabled)
    .map(([key, pal]) => ({
      id: key,
      ...text(key),
      icon: icon(palIcon(key, pal.is_pal !== false)),
      isPal: pal.is_pal !== false,
      // Bosses, NPCs and event variants carry 0 or -2 here: not a Paldeck slot.
      dexIndex: pal.pal_deck_index > 0 ? pal.pal_deck_index : null,
      elements: pal.element_types ?? [],
      rarity: pal.rarity ?? 0,
      size: pal.size ?? null,
      genus: pal.genus_category ?? null,
      boss: Boolean(pal.is_boss || pal.is_tower_boss || pal.is_raid_boss),
      nocturnal: Boolean(pal.nocturnal),
      scaling: pal.scaling ?? { hp: 0, attack: 0, defense: 0 },
      stamina: pal.stamina ?? 0,
      foodAmount: pal.food_amount ?? 0,
      price: Math.round(pal.price ?? 0),
      speeds: {
        walk: pal.walk_speed ?? 0,
        run: pal.run_speed ?? 0,
        rideSprint: pal.ride_sprint_speed ?? 0,
        transport: pal.transport_speed ?? 0,
      },
      work: Object.fromEntries(
        Object.entries(pal.work_suitability ?? {}).filter(([, v]) => v > 0),
      ),
      skills: Object.entries(pal.skill_set ?? {}).map(([id, level]) => ({
        id,
        level,
      })),
      passives: pal.passive_skills ?? [],
    }))
    .sort(
      (a, b) =>
        (a.dexIndex ?? Infinity) - (b.dexIndex ?? Infinity) ||
        a.name.localeCompare(b.name),
    );
}

async function items() {
  const raw = await load("items.json");
  const text = await localised("items.json");

  return Object.entries(raw)
    .filter(([, item]) => !item.disabled)
    .map(([key, item]) => ({
      id: key,
      ...text(key),
      icon: icon(item.icon),
      group: item.group ?? null,
      typeA: item.type_a ?? null,
      typeB: item.type_b ?? null,
      rank: item.rank ?? 0,
      rarity: item.rarity ?? 0,
      maxStack: item.max_stack_count ?? 0,
      weight: item.weight ?? 0,
      price: item.price ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function activeSkills() {
  const raw = await load("active_skills.json");
  const text = await localised("active_skills.json");

  return Object.entries(raw)
    .filter(([, skill]) => !skill.disabled)
    .map(([key, skill]) => ({
      id: key.replace("EPalWazaID::", ""),
      ...text(key),
      element: skill.element ?? null,
      type: skill.type ?? null,
      power: skill.power ?? 0,
      cooldown: skill.cool_time ?? 0,
      minRange: skill.min_range ?? 0,
      maxRange: skill.max_range ?? 0,
      effects: (skill.effects ?? []).filter((effect) => effect.type !== "None"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function passiveSkills() {
  const raw = await load("passive_skills.json");
  const text = await localised("passive_skills.json");

  return Object.entries(raw)
    .filter(([, skill]) => !skill.disabled)
    .map(([key, skill]) => ({
      id: key,
      ...text(key),
      rank: skill.rank ?? 0,
      effects: (skill.effects ?? []).filter((effect) => effect.type !== "None"),
      attachesTo: [
        skill.add_pal && "Pals",
        skill.add_rare_pal && "Rare Pals",
        skill.add_shot_weapon && "Ranged weapons",
        skill.add_melee_weapon && "Melee weapons",
        skill.add_armor && "Armour",
        skill.add_accessory && "Accessories",
      ].filter(Boolean),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function elements() {
  const raw = await load("elements.json");
  const text = await localised("elements.json");

  return Object.entries(raw).map(([key, element]) => ({
    id: key,
    ...text(key),
    color: element.color ?? "#888888",
    icon: icon(element.icon),
  }));
}

async function workSuitability(palList) {
  const text = await localised("work_suitability.json");

  return Object.keys(WORK_ICONS).map((key) => ({
    id: key,
    ...text(key),
    icon: icon(WORK_ICONS[key]),
    // The pals that can do this job at all, best first.
    pals: palList
      .filter((pal) => pal.work[key] > 0)
      .map((pal) => ({ id: pal.id, name: pal.name, level: pal.work[key] }))
      .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)),
  }));
}

async function technologies() {
  const raw = await load("technologies.json");
  const text = await localised("technologies.json");

  return Object.entries(raw)
    .map(([key, tech]) => ({
      id: key,
      ...text(key),
      icon: icon(tech.icon),
      tier: tech.tier ?? 0,
      cost: tech.cost ?? 0,
      levelCap: tech.level_cap ?? 0,
      boss: Boolean(tech.is_boss_technology),
      requires:
        tech.require_technology === "None" ? null : tech.require_technology,
      unlocksItems: tech.unlock_item_recipes ?? [],
      unlocksBuildings: tech.unlock_build_objects ?? [],
    }))
    .sort((a, b) => a.levelCap - b.levelCap || a.name.localeCompare(b.name));
}

async function buildings() {
  const raw = await load("buildings.json");
  const text = await localised("buildings.json");

  return Object.entries(raw)
    .map(([key, building]) => ({
      id: key,
      ...text(key),
      icon: icon(building.icon),
      typeA: building.type_a ?? null,
      typeB: building.type_b ?? null,
      rank: building.rank ?? 0,
      hp: building.hp ?? 0,
      defense: building.defense ?? 0,
      energy:
        building.required_energy_type === "None"
          ? null
          : building.required_energy_type,
      materials: building.materials ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function copyIcons() {
  if (!ASSETS) {
    console.log("no --assets given, skipping icon copy");
    return;
  }

  const source = resolve(ASSETS);
  const target = join(OUT, "img");
  await mkdir(target, { recursive: true });

  const available = new Set(await readdir(source));
  let copied = 0;
  const missing = [];

  for (const name of icons) {
    // Save Pal falls back to the menu portrait when the full render is absent.
    const candidates = [`${name}.webp`, `t_${name}_icon_normal.webp`];
    const found = candidates.find((file) => available.has(file));
    if (!found) {
      missing.push(name);
      continue;
    }
    await cp(join(source, found), join(target, `${name}.webp`));
    copied += 1;
  }

  console.log(`icons: ${copied} copied, ${missing.length} missing`);
  if (missing.length)
    console.log(`  missing: ${missing.slice(0, 12).join(", ")}…`);
}

async function main() {
  if (!existsSync(DATA)) {
    console.error(`game data not found at ${DATA}`);
    process.exit(1);
  }

  await mkdir(join(OUT, "data"), { recursive: true });

  const palList = await pals();
  const sets = {
    pals: palList,
    items: await items(),
    "active-skills": await activeSkills(),
    "passive-skills": await passiveSkills(),
    elements: await elements(),
    "work-suitability": await workSuitability(palList),
    technologies: await technologies(),
    buildings: await buildings(),
  };

  for (const [name, value] of Object.entries(sets)) {
    const file = join(OUT, "data", `${name}.json`);
    await writeFile(file, JSON.stringify(value));
    const size = (JSON.stringify(value).length / 1024).toFixed(0);
    console.log(`${name}: ${value.length} entries, ${size} KB`);
  }

  await copyIcons();
}

await main();
