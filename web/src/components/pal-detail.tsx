"use client";

import { useMemo, useState } from "react";
import type {
  PalDetail as PalDetailModel,
  UpdatePalRequest,
} from "@/lib/palsave-api";
import { buildPalUpdate, STAR_OPTIONS, validateSkillIds } from "@/lib/pal-form";
import { humanizeId, shortId } from "@/lib/format";
import { AlertIcon, PalIcon, TreeIcon } from "@/components/icons";
import { WikiIcon } from "@/components/wiki-browser";
import { SpeciesSelect } from "@/components/species-select";
import {
  ELEMENT_COLORS,
  lookupSpecies,
  usePalCatalog,
} from "@/lib/pal-catalog";

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

const IVS = [
  ["talentHp", "HP"],
  ["talentMelee", "Melee"],
  ["talentShot", "Ranged"],
  ["talentDefense", "Defence"],
] as const;
const SOULS = [
  ["rankHp", "HP"],
  ["rankAttack", "Attack"],
  ["rankDefence", "Defence"],
  ["rankCraftSpeed", "Work"],
] as const;

const BOSS = "BOSS_";
const base = (id?: string | null) => (id ?? "").replace(/^(BOSS_|GYM_)/, "");
const isAlpha = (id?: string | null) => (id ?? "").startsWith(BOSS);
const UNUSUAL_THRESHOLD = 100;

function ElementChip({ el }: { el: string }) {
  const c = ELEMENT_COLORS[el];
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        color: c ?? "var(--color-subtle)",
        background: c ? `${c}1f` : "var(--color-sunken)",
      }}
    >
      {el}
    </span>
  );
}

function StatBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value?: number;
  max: number;
  color: string;
}) {
  const v = value ?? 0;
  const pct = Math.max(0, Math.min(100, (v / max) * 100));
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-subtle">{label}</span>
        <span className="tabular-nums">{v}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
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
  const catalog = usePalCatalog();
  const speciesOptions = useMemo(
    () => Array.from(catalog.values()).sort((a, b) => a.dex - b.dex),
    [catalog],
  );

  if (loading)
    return (
      <p className="p-6 text-sm text-muted" role="status">
        Loading Pal details…
      </p>
    );
  if (error)
    return (
      <p className="p-6 text-sm text-danger" role="alert">
        {error}
      </p>
    );
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
  const species = lookupSpecies(catalog, form.characterId);
  const el0 = species?.elements?.[0];
  const barColor = el0
    ? (ELEMENT_COLORS[el0] ?? "var(--color-accent)")
    : "var(--color-accent)";
  const alpha = isAlpha(form.characterId);

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
      className="scroll-slim max-h-168 space-y-5 overflow-y-auto p-4"
      aria-label="Selected character details"
    >
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <div
            className="grid size-20 place-items-center overflow-hidden rounded-xl border border-line bg-sunken"
            style={
              el0
                ? { boxShadow: `inset 0 0 0 2px ${ELEMENT_COLORS[el0]}66` }
                : undefined
            }
          >
            {species?.icon ? (
              <WikiIcon icon={species.icon} alt="" className="size-18" />
            ) : (
              <PalIcon className="size-8 text-subtle" />
            )}
          </div>
          {alpha && (
            <span
              className="absolute -right-1.5 -top-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ background: "#f0733b" }}
            >
              ALPHA
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold">
            {form.nickname || species?.name || humanizeId(form.characterId)}
          </h3>
          <p className="truncate text-sm text-subtle">
            {species?.name ?? humanizeId(form.characterId)}
            <span className="ml-1.5 tabular-nums text-foreground">
              Lv {form.level ?? "—"}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {species?.elements?.map((el) => (
              <ElementChip key={el} el={el} />
            ))}
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
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {capabilities.characterId && form.characterId && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">Species</span>
                <SpeciesSelect
                  value={base(form.characterId)}
                  options={speciesOptions}
                  onChangeAction={(id) =>
                    set(
                      "characterId",
                      (isAlpha(form.characterId) ? BOSS : "") + id,
                    )
                  }
                />
              </label>
              <label className="flex items-end gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={alpha}
                  onChange={(e) =>
                    set(
                      "characterId",
                      (e.target.checked ? BOSS : "") + base(form.characterId),
                    )
                  }
                />
                <span className="text-sm">Alpha / Boss variant</span>
              </label>
            </div>
          )}

          {capabilities.nickname && (
            <label className="block">
              <span className="field-label">Nickname</span>
              <input
                value={form.nickname ?? ""}
                maxLength={64}
                onChange={(e) => set("nickname", e.target.value)}
                className="field"
              />
            </label>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {capabilities.rank && (
              <label className="block">
                <span className="field-label">Star progression</span>
                <select
                  value={form.rank ?? 1}
                  onChange={(e) => set("rank", Number(e.target.value))}
                  className="field"
                >
                  {STAR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
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
                  onChange={(e) => set("gender", e.target.value)}
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
                      onChange={(e) => set(key, Number(e.target.value))}
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
                          onChange={(e) =>
                            setForm((current) => {
                              if (!current) return current;
                              const next = [...current[key]];
                              next[position] = e.target.value;
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
                                      (_, i) => i !== position,
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
          {IVS.some(([k]) => detail[k] !== undefined) && (
            <div>
              <h4 className="mb-2 text-xs font-medium text-subtle">
                IVs (Talents)
              </h4>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {IVS.map(
                  ([key, label]) =>
                    detail[key] !== undefined && (
                      <StatBar
                        key={key}
                        label={label}
                        value={detail[key] as number}
                        max={100}
                        color={barColor}
                      />
                    ),
                )}
              </div>
            </div>
          )}

          <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <div className="panel p-2.5">
              <dt className="text-xs text-subtle">Level</dt>
              <dd className="mt-0.5 text-sm tabular-nums">
                {detail.level ?? "—"}
              </dd>
            </div>
            <div className="panel p-2.5">
              <dt className="text-xs text-subtle">Stars</dt>
              <dd className="mt-0.5 text-sm tabular-nums">
                {detail.rank !== undefined ? Math.max(0, detail.rank - 1) : "—"}
              </dd>
            </div>
            {SOULS.map(([key, label]) => (
              <div key={key} className="panel p-2.5">
                <dt className="text-xs text-subtle">Soul {label}</dt>
                <dd className="mt-0.5 text-sm tabular-nums">
                  {detail[key] ?? "—"}
                </dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["Active skills", detail.activeSkills],
                ["Passive skills", detail.passiveSkills],
              ] as const
            ).map(([label, values]) => (
              <div key={label}>
                <h4 className="text-xs font-medium text-subtle">{label}</h4>
                {values.length ? (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {values.map((value, index) => (
                      <li
                        key={`${value}-${index}`}
                        className="badge"
                        title={value}
                      >
                        {humanizeId(value)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-sm text-subtle">None saved</p>
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
