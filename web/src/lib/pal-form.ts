import type { PalDetail, PalSummary, UpdatePalRequest } from "./palsave-api";
export const STAR_OPTIONS = [
  { value: 1, label: "No stars" },
  { value: 2, label: "1 star" },
  { value: 3, label: "2 stars" },
  { value: 4, label: "3 stars" },
  { value: 5, label: "4 stars" },
] as const;
export function rankLabel(value: number) {
  return STAR_OPTIONS.find((option) => option.value === value)?.label;
}
export function validateSkillIds(values: string[]): string | undefined {
  if (values.length > 64) return "At most 64 skills are allowed";
  if (values.some((v) => !v.length)) return "Skill identifiers cannot be empty";
  if (values.some((v) => [...v].length > 128))
    return "Skill identifiers must contain at most 128 characters";
  if (new Set(values).size !== values.length)
    return "Duplicate skill identifiers are not allowed";
}
export function buildPalUpdate(
  original: PalDetail,
  current: PalDetail,
  expectedRevision: number,
): UpdatePalRequest {
  const request: UpdatePalRequest = { expectedRevision };
  const scalar = [
    "nickname",
    "characterId",
    "level",
    "rank",
    "gender",
    "rankHp",
    "rankAttack",
    "rankDefence",
    "rankCraftSpeed",
    "talentHp",
    "talentMelee",
    "talentShot",
    "talentDefense",
  ] as const;
  for (const key of scalar)
    if (current[key] !== original[key])
      (request as unknown as Record<string, unknown>)[key] = {
        value: current[key] ?? "",
      };
  for (const key of ["passiveSkills", "activeSkills"] as const)
    if (JSON.stringify(current[key]) !== JSON.stringify(original[key]))
      request[key] = { value: current[key] };
  return request;
}
export function updatePalRow(items: PalSummary[], pal: PalDetail) {
  return items.map((item) =>
    item.id === pal.id
      ? {
          ...item,
          nickname: pal.nickname,
          characterId: pal.characterId,
          level: pal.level,
          rank: pal.rank,
          gender: pal.gender,
          parseStatus: pal.parseStatus,
        }
      : item,
  );
}
