"use client";

import { useState } from "react";
import { STAR_OPTIONS } from "@/lib/pal-form";
import { SkillSelect } from "@/components/skill-select";
import type { SkillOption } from "@/lib/skill-catalog";

export function BulkBar({
  count,
  passiveOptions,
  busy,
  onApplyAction,
  onClearAction,
}: {
  count: number;
  passiveOptions: SkillOption[];
  busy: boolean;
  onApplyAction: (
    fields: Record<string, { value: number }>,
    addPassiveSkills: string[],
  ) => void;
  onClearAction: () => void;
}) {
  const [level, setLevel] = useState("");
  const [rank, setRank] = useState("");
  const [ivs, setIvs] = useState("");
  const [passive, setPassive] = useState("");
  const has = level !== "" || rank !== "" || ivs !== "" || passive !== "";

  function apply() {
    const fields: Record<string, { value: number }> = {};
    if (level !== "") fields.level = { value: Number(level) };
    if (rank !== "") fields.rank = { value: Number(rank) };
    if (ivs !== "") {
      const v = { value: Number(ivs) };
      fields.talentHp = v;
      fields.talentMelee = v;
      fields.talentShot = v;
      fields.talentDefense = v;
    }
    onApplyAction(fields, passive ? [passive] : []);
    setLevel("");
    setRank("");
    setIvs("");
    setPassive("");
  }

  return (
    <div className="border-t border-line bg-raised p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{count} selected</span>
        <button
          type="button"
          className="text-xs text-subtle hover:underline"
          onClick={onClearAction}
        >
          Clear
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="field-label">Level</span>
          <input
            type="number"
            min={1}
            max={255}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            placeholder="—"
            className="field field-sm w-20 tabular-nums"
          />
        </label>
        <label className="block">
          <span className="field-label">Stars</span>
          <select
            value={rank}
            onChange={(e) => setRank(e.target.value)}
            className="field field-sm w-32"
          >
            <option value="">—</option>
            {STAR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">All IVs</span>
          <input
            type="number"
            min={0}
            max={100}
            value={ivs}
            onChange={(e) => setIvs(e.target.value)}
            placeholder="—"
            className="field field-sm w-20 tabular-nums"
          />
        </label>
        <label className="block min-w-40 flex-1">
          <span className="field-label">Add passive</span>
          <SkillSelect
            value={passive}
            options={passiveOptions}
            placeholder="—"
            onChangeAction={setPassive}
          />
        </label>
        <button
          type="button"
          disabled={!has || busy}
          onClick={apply}
          className="btn btn-primary btn-sm"
        >
          {busy ? "Applying…" : `Apply to ${count}`}
        </button>
      </div>
    </div>
  );
}
