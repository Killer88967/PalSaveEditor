import { describe, expect, test } from "bun:test";
import {
  buildPalUpdate,
  rankLabel,
  updatePalRow,
  validateSkillIds,
} from "./pal-form.ts";
const pal = {
  id: "map:1",
  mapIndex: 1,
  isPlayer: false,
  parseStatus: "complete",
  rawPath: [],
  level: 1,
  rank: 1,
  nickname: "Old",
  gender: "Male",
  passiveSkills: ["A"],
  activeSkills: [],
  missingFields: [],
  editCapabilities: {},
};
describe("Pal form helpers", () => {
  test("maps raw rank labels", () => {
    expect(rankLabel(1)).toBe("No stars");
    expect(rankLabel(5)).toBe("4 stars");
  });
  test("omits unchanged values and expresses nickname clearing", () => {
    expect(buildPalUpdate(pal, pal, 3)).toEqual({ expectedRevision: 3 });
    expect(buildPalUpdate(pal, { ...pal, nickname: "" }, 3).nickname).toEqual({
      value: "",
    });
  });
  test("detects invalid skills", () => {
    expect(validateSkillIds(["A", "A"])).toContain("Duplicate");
    expect(validateSkillIds([""])).toContain("empty");
    expect(validateSkillIds(["A"])).toBeUndefined();
  });
  test("updates the selected list row", () => {
    expect(updatePalRow([pal], { ...pal, level: 2 })[0].level).toBe(2);
  });
});
