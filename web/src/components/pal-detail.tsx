"use client";

import { useState, useEffect } from "react";
import type {
  PalDetail as PalDetailModel,
  UpdatePalRequest,
} from "@/lib/palsave-api";
import { buildPalUpdate, STAR_OPTIONS, validateSkillIds } from "@/lib/pal-form";
import { humanizeId, shortId } from "@/lib/format";
import { AlertIcon, PalIcon, TreeIcon } from "@/components/icons";

/** Editable numeric fields, with the bounds the API enforces. */
const NUMBERS = [
  ["level", "Level", 1, 255],
  ["rankHp", "Souls · HP", 0, 255],
  ["rankAttack", "Souls · Attack", 0, 255],
  ["rankDefence", "Souls · Defence", 0, 255],
  ["rankCraftSpeed", "Souls · Work speed", 0, 255],
  ["talentHp", "IV · HP", 0, 255],
  ["talentMelee", "IV · Melee", 0, 255],
  ["talentShot", "IV · Ranged", 0, 255],
  ["talentDefense", "IV · Defence", 0, 255],
] as const;

const BOSS = "BOSS_";
const base = (id: string) => id.replace(/^(BOSS_|GYM_)/, "");
const isAlpha = (id: string) => id.startsWith(BOSS);
// toggle on  -> update characterId = BOSS + base(current)
// toggle off -> update characterId = base(current)

/** Values above this are legal in the file but well outside normal gameplay. */
const UNUSUAL_THRESHOLD = 100;

function Stat({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="panel p-2.5">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="mt-0.5 break-all text-sm tabular-nums">{value ?? "—"}</dd>
    </div>
  );
}

export function PalDetail({
  detail,
  loading,
  error,
  revision,
  onViewRawAction,
  onSaveAction,
}: {
  detail: PalDetailModel | null;
  loading: boolean;
  error?: string;
  revision: number;
  onViewRawAction: (detail: PalDetailModel) => void;
  onSaveAction: (request: UpdatePalRequest) => Promise<PalDetailModel>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<PalDetailModel | null>(detail);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [species, setSpecies] = useState<{ characterId: string; name: string }[]>([]);

  if (loading) {
    return (
      <p className="p-6 text-sm text-muted" role="status">
        Loading Pal details…
      </p>
    );
  }

  if (error) {
    return (
      <p className="p-6 text-sm text-danger" role="alert">
        {error}
      </p>
    );
  }

  if (!detail || !form) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="rounded-xl bg-accent-soft p-3 text-accent">
          <PalIcon className="size-6" />
        </span>
        <p className="text-sm text-muted">
          Select a character to inspect and edit its saved attributes.
        </p>
      </div>
    );
  }

  const capabilities = detail.editCapabilities;

  function set(key: keyof PalDetailModel, value: string | number) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  async function submit() {
    const passive = validateSkillIds(form!.passiveSkills);
    const active = validateSkillIds(form!.activeSkills);
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
      const updated = await onSaveAction(
        buildPalUpdate(detail!, form!, revision),
      );
      setForm(updated);
      setEditing(false);
    } catch (cause) {
      const failure = cause as Error & { fields?: Record<string, string> };
      setFormError(failure.message);
      setFields(failure.fields ?? {});
    } finally {
      setSaving(false);
    }
  }

  const unusual = NUMBERS.slice(1).some(
    ([key]) => Number(form[key] ?? 0) > UNUSUAL_THRESHOLD,
  );

  return (
    <section
      className="scroll-slim max-h-168 space-y-4 overflow-y-auto p-4"
      aria-label="Selected character details"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">
            {form.nickname || humanizeId(form.characterId)}
          </h3>
          <p className="truncate font-mono text-xs text-subtle">
            {form.characterId ?? "—"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {detail.isPlayer && <span className="badge">Player</span>}
            {detail.gender && <span className="badge">{detail.gender}</span>}
            {detail.instanceId && (
              <span className="badge" title={detail.instanceId}>
                <span className="font-mono">{shortId(detail.instanceId)}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          {!editing && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onViewRawAction(detail)}
            title="Jump to this entry in the raw property tree"
          >
            <TreeIcon className="size-4" />
            Raw
          </button>
        </div>
      </div>

      {editing ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {capabilities.nickname && (
            <label className="block">
              <span className="field-label">Nickname</span>
              <input
                value={form.nickname ?? ""}
                maxLength={64}
                onChange={(event) => set("nickname", event.target.value)}
                className="field"
              />
            </label>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {capabilities.rank && (
              <label className="block">
                <span className="field-label">Star progression</span>
                <select
                  value={form.rank}
                  onChange={(event) => set("rank", Number(event.target.value))}
                  className="field"
                >
                  {STAR_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {capabilities.gender && (
              <label className="block">
                <span className="field-label">Gender</span>
                <select
                  value={form.gender}
                  onChange={(event) => set("gender", event.target.value)}
                  className="field"
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </label>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {NUMBERS.map(
              ([key, label, min, max]) =>
                capabilities[key] && (
                  <label key={key} className="block">
                    <span className="field-label">{label}</span>
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={form[key] ?? ""}
                      onChange={(event) => set(key, Number(event.target.value))}
                      className="field tabular-nums"
                      aria-invalid={Boolean(fields[key])}
                    />
                    {fields[key] && (
                      <span className="mt-1 block text-xs text-danger">
                        {fields[key]}
                      </span>
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
              capabilities[key] && (
                <div key={key}>
                  <p className="field-label">
                    {label} <span className="text-subtle">(internal IDs)</span>
                  </p>
                  <div className="space-y-1.5">
                    {form[key].map((skill, position) => (
                      <div key={position} className="flex gap-1.5">
                        <input
                          value={skill}
                          aria-label={`${label} ${position + 1}`}
                          onChange={(event) =>
                            setForm((current) => {
                              if (!current) return current;
                              const next = [...current[key]];
                              next[position] = event.target.value;
                              return { ...current, [key]: next };
                            })
                          }
                          className="field field-sm min-w-0 flex-1 font-mono"
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            setForm((current) =>
                              current
                                ? {
                                    ...current,
                                    [key]: current[key].filter(
                                      (_, index) => index !== position,
                                    ),
                                  }
                                : current,
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="mt-1.5 text-xs text-accent hover:underline"
                    onClick={() =>
                      setForm((current) =>
                        current
                          ? { ...current, [key]: [...current[key], ""] }
                          : current,
                      )
                    }
                  >
                    + Add {key === "passiveSkills" ? "passive" : "active"} skill
                  </button>
                  {fields[key] && (
                    <p className="mt-1 text-xs text-danger">{fields[key]}</p>
                  )}
                </div>
              ),
          )}

          {unusual && (
            <div className="alert alert-warning text-xs">
              <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>
                Values above {UNUSUAL_THRESHOLD} are far outside normal
                gameplay. They will be written faithfully, but may destabilise
                the game.
              </p>
            </div>
          )}

          {formError && (
            <p className="text-sm text-danger" role="alert">
              {formError}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="btn btn-primary btn-sm"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setForm(detail);
                setEditing(false);
                setFields({});
                setFormError(undefined);
              }}
              className="btn btn-secondary btn-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Level" value={detail.level} />
            <Stat
              label="Star rank"
              value={STAR_OPTIONS.find((o) => o.value === detail.rank)?.label}
            />
            {NUMBERS.slice(1).map(([key, label]) => (
              <Stat key={key} label={label} value={detail[key]} />
            ))}
          </dl>

          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["Passive skills", detail.passiveSkills],
                ["Active skills", detail.activeSkills],
              ] as const
            ).map(([label, values]) => (
              <div key={label}>
                <h4 className="text-xs text-subtle">{label}</h4>
                {values.length ? (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {values.map((value, index) => (
                      <li key={`${value}-${index}`} className="badge">
                        <span className="font-mono">{value}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-subtle">None saved</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {detail.missingFields.length > 0 && (
        <div className="alert alert-warning text-xs">
          <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <strong className="font-medium">Not present in this entry:</strong>{" "}
            {detail.missingFields.join(", ")}. Those fields are hidden rather
            than created, so the save keeps its original shape.
          </p>
        </div>
      )}
    </section>
  );
}
