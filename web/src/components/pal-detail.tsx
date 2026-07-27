import type { PalDetail as PalDetailModel } from "@/lib/palsave-api";

function value(value: string | number | undefined) {
  return value ?? "—";
}

function Stat({
  label,
  value: stat,
}: {
  label: string;
  value?: string | number;
}) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-950 p-2">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="break-all text-sm text-neutral-100">{value(stat)}</dd>
    </div>
  );
}

export function PalDetail({
  detail,
  loading,
  error,
  onViewRaw,
}: {
  detail: PalDetailModel | null;
  loading: boolean;
  error?: string;
  onViewRaw: (detail: PalDetailModel) => void;
}) {
  if (loading)
    return <p className="p-4 text-sm text-neutral-400">Loading Pal details…</p>;
  if (error) return <p className="p-4 text-sm text-red-400">❌ {error}</p>;
  if (!detail)
    return (
      <p className="p-4 text-sm text-neutral-500">
        Select a Pal to inspect its saved attributes.
      </p>
    );

  return (
    <section className="space-y-4 p-4" aria-label="Selected Pal details">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-medium">
            {detail.nickname || detail.characterId || "Unknown character"}
          </h3>
          <p className="text-sm text-neutral-500">
            {detail.characterId || "—"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onViewRaw(detail)}
          className="rounded border border-neutral-700 px-2 py-1 text-xs hover:border-neutral-500"
        >
          View in raw tree
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Level" value={detail.level} />
        <Stat label="Rank" value={detail.rank} />
        <Stat label="Gender" value={detail.gender} />
        <Stat label="Map index" value={detail.mapIndex} />
        <Stat label="Rank HP" value={detail.rankHp} />
        <Stat label="Rank attack" value={detail.rankAttack} />
        <Stat label="Rank defence" value={detail.rankDefence} />
        <Stat label="Rank craft speed" value={detail.rankCraftSpeed} />
        <Stat label="Talent HP" value={detail.talentHp} />
        <Stat label="Talent melee" value={detail.talentMelee} />
        <Stat label="Talent shot" value={detail.talentShot} />
        <Stat label="Talent defense" value={detail.talentDefense} />
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <SkillList label="Passive skills" values={detail.passiveSkills} />
        <SkillList label="Active skills" values={detail.activeSkills} />
      </div>

      <dl className="space-y-2 text-xs">
        <div>
          <dt className="text-neutral-500">Owner player UID</dt>
          <dd className="break-all font-mono">
            {value(detail.ownerPlayerUid)}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Instance ID</dt>
          <dd className="break-all font-mono">{value(detail.instanceId)}</dd>
        </div>
      </dl>

      {detail.missingFields.length > 0 && (
        <div className="rounded border border-amber-900/70 bg-amber-950/30 p-3 text-xs text-amber-200">
          Missing or unsupported fields: {detail.missingFields.join(", ")}
        </div>
      )}
    </section>
  );
}

function SkillList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </h4>
      {values.length ? (
        <div className="flex flex-wrap gap-1">
          {values.map((skill) => (
            <span
              key={skill}
              className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
            >
              {skill}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-neutral-600">None saved</p>
      )}
    </div>
  );
}
