import { describe, expect, test } from "bun:test";
import {
  buildPlayerUpdate,
  hasChanges,
  maxLevel,
  spentPoints,
  validatePlayerForm,
} from "./player-form.ts";

const point = (name, label, value) => ({
  name,
  label,
  point: value,
  editable: true,
});

// Shaped like a real player row: Japanese status names, a byte-stored level.
const player = () => ({
  id: "instance:10b4ee74-0000-0000-0000-000000000000",
  mapIndex: 0,
  playerUid: "10b4ee74-0000-0000-0000-000000000000",
  nickname: "Bludistak",
  level: 17,
  maxLevel: 255,
  exp: 38224,
  statusPoints: [
    point("最大HP", "Max HP", 0),
    point("最大SP", "Max stamina", 8),
    point("所持重量", "Carry weight", 8),
  ],
  exStatusPoints: [point("攻撃力", "Attack", 1)],
  missingFields: [],
  editCapabilities: {
    level: true,
    exp: true,
    unusedStatusPoint: false,
    statusPoints: true,
    exStatusPoints: true,
  },
  rawPath: [],
});

describe("buildPlayerUpdate", () => {
  test("sends nothing when the form was not touched", () => {
    const request = buildPlayerUpdate(player(), player(), 3);
    expect(request).toEqual({ expectedRevision: 3 });
    expect(hasChanges(request)).toBe(false);
  });

  test("sends only the status entries whose points moved", () => {
    const edited = player();
    edited.level = 60;
    edited.statusPoints[0].point = 255;
    const request = buildPlayerUpdate(player(), edited, 1);
    expect(request).toEqual({
      expectedRevision: 1,
      level: { value: 60 },
      statusPoints: { value: [{ name: "最大HP", value: 255 }] },
    });
    expect(hasChanges(request)).toBe(true);
    expect(request.exp).toBeUndefined();
    expect(request.exStatusPoints).toBeUndefined();
  });

  test("keys status updates by the save's own name, not by position", () => {
    const edited = player();
    edited.exStatusPoints[0].point = 5;
    const request = buildPlayerUpdate(player(), edited, 0);
    expect(request.exStatusPoints).toEqual({
      value: [{ name: "攻撃力", value: 5 }],
    });
  });

  test("leaves out entries the save cannot write back", () => {
    const edited = player();
    edited.statusPoints[1] = {
      ...edited.statusPoints[1],
      point: 30,
      editable: false,
    };
    expect(buildPlayerUpdate(player(), edited, 0).statusPoints).toBeUndefined();
  });
});

describe("validatePlayerForm", () => {
  test("accepts a level anywhere inside the property's storage", () => {
    const edited = player();
    edited.level = 255;
    expect(validatePlayerForm(edited)).toEqual({});
  });

  test("rejects a level past what the save can store, and level zero", () => {
    for (const level of [0, 256, 1.5]) {
      const edited = player();
      edited.level = level;
      expect(validatePlayerForm(edited).level).toBe(
        "Value must be between 1 and 255",
      );
    }
  });

  test("caps status points at 255 and names the offending entry", () => {
    const edited = player();
    edited.statusPoints[2].point = 300;
    edited.exStatusPoints[0].point = -1;
    const errors = validatePlayerForm(edited);
    expect(errors["statusPoints:所持重量"]).toBe(
      "Value must be between 0 and 255",
    );
    expect(errors["exStatusPoints:攻撃力"]).toBe(
      "Value must be between 0 and 255",
    );
  });

  test("rejects negative experience", () => {
    const edited = player();
    edited.exp = -1;
    expect(validatePlayerForm(edited).exp).toBe(
      "Experience cannot be negative",
    );
  });
});

describe("helpers", () => {
  test("falls back to a byte's ceiling when the save reported no maximum", () => {
    expect(maxLevel(player())).toBe(255);
    expect(maxLevel({ ...player(), maxLevel: undefined })).toBe(255);
    expect(maxLevel({ ...player(), maxLevel: 2147483647 })).toBe(2147483647);
  });

  test("totals the points a player has spent", () => {
    expect(spentPoints(player().statusPoints)).toBe(16);
    expect(spentPoints([])).toBe(0);
  });
});
