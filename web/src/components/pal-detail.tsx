"use client";
import { useState } from "react";
import type {
  PalDetail as PalDetailModel,
  UpdatePalRequest,
} from "@/lib/palsave-api";
import { buildPalUpdate, STAR_OPTIONS, validateSkillIds } from "@/lib/pal-form";
function Stat({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-950 p-2">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="break-all text-sm">{value ?? "—"}</dd>
    </div>
  );
}
const numbers = [
  ["level", "Level", 1, 80],
  ["rankHp", "Rank HP", 0, 255],
  ["rankAttack", "Rank attack", 0, 255],
  ["rankDefence", "Rank defence", 0, 255],
  ["rankCraftSpeed", "Rank craft speed", 0, 255],
  ["talentHp", "Talent HP", 0, 100],
  ["talentMelee", "Talent melee", 0, 100],
  ["talentShot", "Talent shot", 0, 100],
  ["talentDefense", "Talent defense", 0, 100],
] as const;
export function PalDetail({
  detail,
  loading,
  error,
  revision,
  onViewRaw,
  onSave,
}: {
  detail: PalDetailModel | null;
  loading: boolean;
  error?: string;
  revision: number;
  onViewRaw: (d: PalDetailModel) => void;
  onSave: (request: UpdatePalRequest) => Promise<PalDetailModel>;
}) {
  const [editing, setEditing] = useState(false),
    [form, setForm] = useState<PalDetailModel | null>(detail),
    [saving, setSaving] = useState(false),
    [formError, setFormError] = useState<string>(),
    [fields, setFields] = useState<Record<string, string>>({});
  if (loading)
    return <p className="p-4 text-sm text-neutral-400">Loading Pal details…</p>;
  if (error) return <p className="p-4 text-sm text-red-400">❌ {error}</p>;
  if (!detail || !form)
    return (
      <p className="p-4 text-sm text-neutral-500">
        Select a Pal to inspect its saved attributes.
      </p>
    );
  const c = detail.editCapabilities;
  async function submit() {
    const passive = validateSkillIds(form!.passiveSkills),
      active = validateSkillIds(form!.activeSkills);
    if (passive || active) {
      setFields({
        ...(passive ? { passiveSkills: passive } : {}),
        ...(active ? { activeSkills: active } : {}),
      });
      return;
    }
    setSaving(true);
    setFormError(undefined);
    setFields({});
    try {
      const updated = await onSave(buildPalUpdate(detail!, form!, revision));
      setForm(updated);
      setEditing(false);
    } catch (cause) {
      const e = cause as Error & { fields?: Record<string, string> };
      setFormError(e.message);
      setFields(e.fields ?? {});
    } finally {
      setSaving(false);
    }
  }
  const input = (
    key: keyof PalDetailModel,
    value: string | number | undefined,
  ) =>
    setForm((cur) =>
      cur ? { ...cur, [key]: typeof value === "number" ? value : value } : cur,
    );
  return (
    <section className="space-y-4 p-4" aria-label="Selected Pal details">
      <div className="flex justify-between gap-2">
        <div>
          <h3 className="text-lg font-medium">
            {form.nickname || form.characterId || "Unknown character"}
          </h3>
          <p className="text-sm text-neutral-500">{form.characterId || "—"}</p>
        </div>
        <div className="flex gap-2">
          {!editing && (
            <button
              className="rounded border border-sky-700 px-2 py-1 text-xs"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          )}
          <button
            className="rounded border border-neutral-700 px-2 py-1 text-xs"
            onClick={() => onViewRaw(detail)}
          >
            View raw
          </button>
        </div>
      </div>
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {c.nickname && (
            <label className="block text-xs">
              Nickname
              <input
                value={form.nickname ?? ""}
                maxLength={64}
                onChange={(e) => input("nickname", e.target.value)}
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2"
              />
            </label>
          )}
          {c.rank && (
            <label className="block text-xs">
              Star progression
              <select
                value={form.rank}
                onChange={(e) => input("rank", Number(e.target.value))}
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2"
              >
                {STAR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} (save rank {o.value})
                  </option>
                ))}
              </select>
            </label>
          )}
          {c.gender && (
            <label className="block text-xs">
              Gender
              <select
                value={form.gender}
                onChange={(e) => input("gender", e.target.value)}
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            {numbers.map(
              ([key, label, min, max]) =>
                c[key] && (
                  <label key={key} className="text-xs">
                    {label}
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={form[key] ?? ""}
                      onChange={(e) => input(key, Number(e.target.value))}
                      className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2"
                    />
                    {fields[key] && (
                      <span className="text-red-400">{fields[key]}</span>
                    )}
                  </label>
                ),
            )}
          </div>
          {(
            [
              ["passiveSkills", "Passive skills"],
              ["activeSkills", "Active skills"],
            ] as const
          ).map(
            ([key, label]) =>
              c[key] && (
                <div key={key}>
                  <p className="text-xs font-medium">
                    {label}{" "}
                    <span className="text-neutral-500">(internal IDs)</span>
                  </p>
                  {form[key].map((skill, i) => (
                    <div key={i} className="mt-1 flex gap-1">
                      <input
                        value={skill}
                        onChange={(e) =>
                          setForm((cur) => {
                            if (!cur) return cur;
                            const v = [...cur[key]];
                            v[i] = e.target.value;
                            return { ...cur, [key]: v };
                          })
                        }
                        className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 p-2 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setForm((cur) =>
                            cur
                              ? {
                                  ...cur,
                                  [key]: cur[key].filter((_, n) => n !== i),
                                }
                              : cur,
                          )
                        }
                        className="px-2"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setForm((cur) =>
                        cur ? { ...cur, [key]: [...cur[key], ""] } : cur,
                      )
                    }
                    className="mt-1 text-xs text-sky-400"
                  >
                    Add {key === "passiveSkills" ? "passive" : "active"} skill
                  </button>
                  {fields[key] && (
                    <p className="text-xs text-red-400">{fields[key]}</p>
                  )}
                </div>
              ),
          )}
          {numbers
            .slice(1, 5)
            .some(([key]) => Number(form[key] ?? 0) > 100) && (
            <p className="rounded border border-amber-800 p-2 text-xs text-amber-300">
              Advanced value. Extremely high stats may destabilize gameplay or
              cause unexpected behavior.
            </p>
          )}
          {formError && <p className="text-xs text-red-400">{formError}</p>}
          <div className="flex gap-2">
            <button
              disabled={saving}
              className="rounded bg-sky-700 px-3 py-1.5 text-sm"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setForm(detail);
                setEditing(false);
                setFields({});
              }}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Level" value={detail.level} />
            <Stat
              label="Star rank"
              value={STAR_OPTIONS.find((o) => o.value === detail.rank)?.label}
            />
            {numbers.slice(1).map(([key, label]) => (
              <Stat key={key} label={label} value={detail[key]} />
            ))}
          </dl>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["Passive skills", detail.passiveSkills],
                ["Active skills", detail.activeSkills],
              ] as const
            ).map(([label, v]) => (
              <div key={label}>
                <h4 className="text-xs text-neutral-500">{label}</h4>
                <p className="wrap-break-word text-xs">
                  {v.join(", ") || "None saved"}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
      {detail.missingFields.length > 0 && (
        <div className="rounded border border-amber-900 p-2 text-xs text-amber-200">
          Missing or unsupported: {detail.missingFields.join(", ")}
        </div>
      )}
    </section>
  );
}
