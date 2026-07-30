import { describe, expect, test } from "bun:test";
import {
  formatCount,
  formatDecimal,
  formatFileSize,
  humanizeId,
  roundtripFileName,
  shortId,
  stripExtension,
} from "./format";

describe("formatFileSize", () => {
  test("scales into the right unit and keeps bytes whole", () => {
    expect(formatFileSize(0)).toBe("0 bytes");
    expect(formatFileSize(512)).toBe("512 bytes");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(498401)).toBe("486.7 KB");
    expect(formatFileSize(7059486)).toBe("6.7 MB");
    expect(formatFileSize(1024 ** 4)).toBe("1.0 TB");
  });

  test("never renders NaN or negative sizes", () => {
    expect(formatFileSize(-1)).toBe("0 bytes");
    expect(formatFileSize(Number.NaN)).toBe("0 bytes");
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe("0 bytes");
  });
});

describe("formatCount and formatDecimal", () => {
  test("render an em dash instead of a misleading zero", () => {
    expect(formatCount(undefined)).toBe("—");
    expect(formatCount(null)).toBe("—");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatDecimal(undefined)).toBe("—");
    expect(formatDecimal(24.040268)).toBe("24.0");
    expect(formatDecimal(24.040268, 2)).toBe("24.04");
  });
});

describe("shortId", () => {
  test("elides only identifiers that are actually long", () => {
    expect(shortId()).toBe("—");
    expect(shortId("short")).toBe("short");
    expect(shortId("c1b07a9e-7953-4b0e-bd5e-ed18d8df27b3")).toBe(
      "c1b07a9e…27b3",
    );
  });
});

describe("humanizeId", () => {
  test("splits internal identifiers into words", () => {
    expect(humanizeId("BOSS_KingBahamut_Dragon")).toBe(
      "BOSS King Bahamut Dragon",
    );
    expect(humanizeId("CloverFairy")).toBe("Clover Fairy");
    expect(humanizeId("Deer")).toBe("Deer");
    expect(humanizeId("PinkCat_2")).toBe("Pink Cat 2");
    expect(humanizeId(undefined)).toBe("Unknown");
    expect(humanizeId("")).toBe("Unknown");
  });
});

describe("file naming", () => {
  test("strips directories and matching extensions case-insensitively", () => {
    expect(stripExtension("Level.sav", ".sav")).toBe("Level");
    expect(stripExtension("saves/world/Level.SAV", ".sav")).toBe("Level");
    expect(stripExtension("C:\\saves\\Level.sav", ".sav")).toBe("Level");
    expect(stripExtension("Level", ".sav")).toBe("Level");
    expect(stripExtension("Level.sav", ".gvas")).toBe("Level.sav");
  });

  test("falls back to Level when nothing is left", () => {
    expect(stripExtension(".sav", ".sav")).toBe("Level");
    expect(roundtripFileName(".sav")).toBe("Level.roundtrip.sav");
    expect(roundtripFileName("Level.sav")).toBe("Level.roundtrip.sav");
  });
});
