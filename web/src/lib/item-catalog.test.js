import { describe, expect, test } from "bun:test";
import {
  catalog,
  categorizeItem,
  categoryCounts,
  defaultCategoryFor,
  nextFreeSlot,
  searchCatalog,
} from "./item-catalog";

const item = (itemId, stacks = 1, hasDynamicTemplate = false) => ({
  itemId,
  stacks,
  totalQuantity: stacks,
  hasDynamicTemplate,
});

describe("categorizeItem", () => {
  test("recognises the key items Palworld keeps in the essential container", () => {
    // Every id here was read out of a real save's essential container.
    expect(categorizeItem("KeySphere_01")).toBe("key");
    expect(categorizeItem("SkillUnlock_Garm")).toBe("key");
    expect(categorizeItem("TreasureBoxKey02")).toBe("key");
    expect(categorizeItem("AutoMealPouch_Tier2")).toBe("key");
    expect(categorizeItem("WorkSuitability_AddTicket_ProductMedicine")).toBe(
      "key",
    );
    expect(categorizeItem("Money")).toBe("key");
  });

  test("sorts the remaining staples into usable buckets", () => {
    expect(categorizeItem("PalSphere_Mega")).toBe("sphere");
    expect(categorizeItem("PalEgg_Normal_01")).toBe("sphere");
    expect(categorizeItem("Arrow")).toBe("ammo");
    expect(categorizeItem("GunPowder2")).toBe("ammo");
    expect(categorizeItem("ClothArmorHeat_2")).toBe("gear");
    expect(categorizeItem("Axe_Tier_00")).toBe("gear");
    expect(categorizeItem("Glider_Good")).toBe("gear");
    expect(categorizeItem("Baked_Berries")).toBe("food");
    expect(categorizeItem("Wood")).toBe("material");
    expect(categorizeItem("ManganeseOre")).toBe("material");
  });
});

describe("searchCatalog", () => {
  const entries = catalog([
    item("KeySphere_01", 3),
    item("KeySphere_02", 1),
    item("PalSphere", 165),
    item("Wood", 40),
    item("Axe_Tier_00", 2, true),
  ]);

  test("matches across the underscores in an id", () => {
    expect(searchCatalog(entries, "key sphere").map((e) => e.itemId)).toEqual([
      "KeySphere_01",
      "KeySphere_02",
    ]);
  });

  test("is case insensitive and matches partial words", () => {
    expect(searchCatalog(entries, "sphere").map((e) => e.itemId)).toEqual([
      "KeySphere_01",
      "KeySphere_02",
      "PalSphere",
    ]);
  });

  test("can narrow to one category and keeps the incoming order", () => {
    expect(searchCatalog(entries, "", "key").map((e) => e.itemId)).toEqual([
      "KeySphere_01",
      "KeySphere_02",
    ]);
  });

  test("honours the result limit", () => {
    expect(searchCatalog(entries, "", undefined, 2)).toHaveLength(2);
  });

  test("carries the dynamic template flag through", () => {
    expect(searchCatalog(entries, "axe")[0].hasDynamicTemplate).toBe(true);
  });
});

describe("categoryCounts", () => {
  test("counts only the categories present", () => {
    const counts = categoryCounts(
      catalog([item("KeySphere_01"), item("Wood"), item("Stone")]),
    );

    expect(counts).toEqual([
      { category: "key", count: 1 },
      { category: "material", count: 2 },
    ]);
  });
});

describe("defaultCategoryFor", () => {
  test("preselects the filter a container is mostly filled with", () => {
    expect(defaultCategoryFor("EssentialContainerId")).toBe("key");
    expect(defaultCategoryFor("WeaponLoadOutContainerId")).toBe("gear");
    expect(defaultCategoryFor("FoodEquipContainerId")).toBe("food");
    expect(defaultCategoryFor("CommonContainerId")).toBeUndefined();
  });
});

describe("nextFreeSlot", () => {
  test("finds the first gap, because saves store occupied slots only", () => {
    expect(nextFreeSlot(42, [0, 1, 2])).toBe(3);
    expect(nextFreeSlot(9, [1, 4, 5])).toBe(0);
    expect(nextFreeSlot(3, [0, 2])).toBe(1);
  });

  test("reports a full container and ignores unreadable slots", () => {
    expect(nextFreeSlot(2, [0, 1])).toBeUndefined();
    expect(nextFreeSlot(0, [])).toBeUndefined();
    expect(nextFreeSlot(2, [undefined, 0])).toBe(1);
  });
});
