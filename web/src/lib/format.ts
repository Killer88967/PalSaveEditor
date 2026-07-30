/** Formatting helpers shared by the editor, the converter and the home page. */

const SIZE_UNITS = ["bytes", "KB", "MB", "GB", "TB"] as const;

/** Renders a byte count with a unit, e.g. `498 KB` or `6.7 MB`. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 bytes";

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    SIZE_UNITS.length - 1,
  );
  const scaled = bytes / 1024 ** exponent;

  return `${scaled.toFixed(exponent === 0 ? 0 : 1)} ${SIZE_UNITS[exponent]}`;
}

/** Thousands-separated integer, or an em dash when the value is absent. */
export function formatCount(value?: number | null): string {
  return value === undefined || value === null || !Number.isFinite(value)
    ? "—"
    : Math.trunc(value).toLocaleString();
}

/** One-decimal number for averages and ratios. */
export function formatDecimal(value?: number | null, digits = 1): string {
  return value === undefined || value === null || !Number.isFinite(value)
    ? "—"
    : value.toFixed(digits);
}

/** Shortens a UUID so it fits in a table cell without wrapping. */
export function shortId(value?: string | null): string {
  if (!value) return "—";
  return value.length > 15 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

/**
 * Splits an internal Palworld identifier into readable words.
 *
 * `BOSS_KingBahamut_Dragon` becomes `BOSS King Bahamut Dragon`, which reads far
 * better in a leaderboard than the raw id. The original is still shown wherever
 * exactness matters.
 */
export function humanizeId(value?: string | null): string {
  if (!value) return "Unknown";

  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Names the file produced by a round-trip export of `name`. */
export function roundtripFileName(name: string): string {
  return `${stripExtension(name, ".sav")}.roundtrip.sav`;
}

/** Drops a trailing extension (case-insensitively) and any directory prefix. */
export function stripExtension(name: string, extension: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const trimmed = base.toLowerCase().endsWith(extension.toLowerCase())
    ? base.slice(0, -extension.length)
    : base;

  return trimmed || "Level";
}
