import type { KnownItem } from "@/lib/palsave-api";

/**
 * Buckets for the item ids found in a save. Palworld has no category field on
 * a slot, so these are read off the id itself — enough to make a long list
 * navigable, never used to decide what may be written.
 */
export type ItemCategory =
  | "key"
  | "sphere"
  | "gear"
  | "ammo"
  | "food"
  | "material";

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  key: "Key items",
  sphere: "Spheres",
  gear: "Gear",
  ammo: "Ammo",
  food: "Food",
  material: "Materials",
};

/** Ordered: the first matching rule wins. */
const RULES: { category: ItemCategory; patterns: RegExp[] }[] = [
  {
    category: "key",
    patterns: [
      /^KeySphere/i,
      /^SkillUnlock/i,
      /^TreasureBoxKey/i,
      /^AutoMealPouch/i,
      /^WorkSuitability_AddTicket/i,
      /^PalGear/i,
      /^Coin$/i,
      /^DogCoin$/i,
      /^Money$/i,
      /Ticket/i,
    ],
  },
  { category: "sphere", patterns: [/^PalSphere/i, /^PalEgg/i] },
  {
    category: "ammo",
    patterns: [/^Arrow/i, /Bullet/i, /^Ammo/i, /Shell/i, /GunPowder/i],
  },
  {
    category: "gear",
    patterns: [
      /Armor/i,
      /Helmet/i,
      /Shield/i,
      /Glider/i,
      /Bow$/i,
      /Bow_/i,
      /Rifle/i,
      /Gun/i,
      /Pistol/i,
      /Launcher/i,
      /Axe_/i,
      /Pickaxe/i,
      /Spear/i,
      /Sword/i,
      /Handgun/i,
      /Accessory/i,
      /^Grapp/i,
    ],
  },
  {
    category: "food",
    patterns: [
      /^Baked_/i,
      /^Cooked_/i,
      /^Salad/i,
      /^Pizza/i,
      /^Soup/i,
      /^Bread/i,
      /Berries$/i,
      /Meat$/i,
      /^Milk$/i,
      /^Egg$/i,
      /^Potion/i,
      /Juice/i,
    ],
  },
];

export function categorizeItem(itemId: string): ItemCategory {
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(itemId))) {
      return rule.category;
    }
  }

  return "material";
}

/** The category a container is mostly filled with, used to preselect a filter. */
export function defaultCategoryFor(
  containerKind: string,
): ItemCategory | undefined {
  switch (containerKind) {
    case "EssentialContainerId":
      return "key";
    case "WeaponLoadOutContainerId":
    case "PlayerEquipArmorContainerId":
      return "gear";
    case "FoodEquipContainerId":
      return "food";
    default:
      return undefined;
  }
}

export interface CatalogEntry extends KnownItem {
  category: ItemCategory;
}

export function catalog(items: KnownItem[]): CatalogEntry[] {
  return items.map((item) => ({
    ...item,
    category: categorizeItem(item.itemId),
  }));
}

/**
 * Filters the catalogue for the add-item picker. Matching is on the raw id and
 * on its humanised words, so "key sphere" finds `KeySphere_01`.
 */
export function searchCatalog(
  entries: CatalogEntry[],
  query: string,
  category?: ItemCategory,
  limit = 40,
): CatalogEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const matches = entries.filter((entry) => {
    if (category && entry.category !== category) return false;

    const haystack =
      `${entry.itemId} ${entry.itemId.replace(/[_-]+/g, " ")}`.toLowerCase();

    return terms.every((term) => haystack.includes(term));
  });

  return matches.slice(0, limit);
}

/** Counts per category, for the picker's filter chips. */
export function categoryCounts(
  entries: CatalogEntry[],
): { category: ItemCategory; count: number }[] {
  const counts = new Map<ItemCategory, number>();

  for (const entry of entries) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }

  return (Object.keys(CATEGORY_LABELS) as ItemCategory[])
    .map((category) => ({ category, count: counts.get(category) ?? 0 }))
    .filter((entry) => entry.count > 0);
}

/**
 * The lowest slot the game would fill next, or undefined when the container is
 * full. Saves store occupied slots only, so gaps are genuinely empty.
 */
export function nextFreeSlot(
  capacity: number,
  taken: (number | undefined)[],
): number | undefined {
  const used = new Set(taken.filter((value) => value !== undefined));

  for (let index = 0; index < capacity; index += 1) {
    if (!used.has(index)) return index;
  }

  return undefined;
}
