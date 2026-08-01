import type {
  PlayerDetail,
  PlayerStatusPoint,
  StatusPointUpdate,
  UpdatePlayerRequest,
} from "./palsave-api";

/** Status points are capped where Pal souls and IVs are: one byte's worth. */
export const MAX_STATUS_POINT = 255;

/** Level has no cap of its own, so fall back to what a byte can hold. */
export const DEFAULT_MAX_LEVEL = 255;

export type StatusKind = "statusPoints" | "exStatusPoints";

export function maxLevel(player: PlayerDetail) {
  return player.maxLevel ?? DEFAULT_MAX_LEVEL;
}

/** Points the player has spent in a list, for the "n spent" header. */
export function spentPoints(points: PlayerStatusPoint[]) {
  return points.reduce((total, entry) => total + (entry.point ?? 0), 0);
}

/**
 * Field errors the API would return anyway, surfaced before the request so a
 * typo does not cost a round trip. Keys are wire field names, with status
 * entries keyed as `statusPoints:<name>`.
 */
export function validatePlayerForm(
  player: PlayerDetail,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const limit = maxLevel(player);

  if (player.level !== undefined && !inRange(player.level, 1, limit)) {
    errors.level = `Value must be between 1 and ${limit}`;
  }
  if (
    player.exp !== undefined &&
    (!Number.isInteger(player.exp) || player.exp < 0)
  ) {
    errors.exp = "Experience cannot be negative";
  }
  if (
    player.unusedStatusPoint !== undefined &&
    !inRange(player.unusedStatusPoint, 0, MAX_STATUS_POINT)
  ) {
    errors.unusedStatusPoint = `Value must be between 0 and ${MAX_STATUS_POINT}`;
  }
  for (const kind of ["statusPoints", "exStatusPoints"] as const) {
    for (const entry of player[kind]) {
      if (
        entry.point !== undefined &&
        !inRange(entry.point, 0, MAX_STATUS_POINT)
      ) {
        errors[`${kind}:${entry.name}`] =
          `Value must be between 0 and ${MAX_STATUS_POINT}`;
      }
    }
  }

  return errors;
}

/** Only the fields the form actually changed, so untouched values are left alone. */
export function buildPlayerUpdate(
  original: PlayerDetail,
  current: PlayerDetail,
  expectedRevision: number,
): UpdatePlayerRequest {
  const request: UpdatePlayerRequest = { expectedRevision };

  for (const key of ["level", "exp", "unusedStatusPoint"] as const) {
    const value = current[key];
    if (value !== undefined && value !== original[key]) {
      request[key] = { value };
    }
  }
  for (const kind of ["statusPoints", "exStatusPoints"] as const) {
    const changed = changedPoints(original[kind], current[kind]);
    if (changed.length) request[kind] = { value: changed };
  }

  return request;
}

export function hasChanges(request: UpdatePlayerRequest) {
  return Object.keys(request).length > 1;
}

function changedPoints(
  original: PlayerStatusPoint[],
  current: PlayerStatusPoint[],
): StatusPointUpdate[] {
  const before = new Map(original.map((entry) => [entry.name, entry.point]));

  return current
    .filter(
      (entry) =>
        entry.editable &&
        entry.point !== undefined &&
        entry.point !== before.get(entry.name),
    )
    .map((entry) => ({ name: entry.name, value: entry.point as number }));
}

function inRange(value: number, min: number, max: number) {
  return Number.isInteger(value) && value >= min && value <= max;
}
