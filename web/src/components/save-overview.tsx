"use client";

import { useEffect, useState } from "react";
import {
  getSaveOverview,
  type SaveOverview,
  type SaveSession,
} from "@/lib/palsave-api";
import {
  formatCount,
  formatDecimal,
  formatFileSize,
  humanizeId,
  shortId,
} from "@/lib/format";
import { RefreshIcon } from "@/components/icons";

const KIND_BADGE: Record<string, string> = {
  map: "badge-accent",
  array: "badge",
  struct: "badge",
  raw: "badge-warning",
  scalar: "badge",
};

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs text-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: React.PropsWithChildren<{ title: string; hint?: string }>) {
  return (
    <section className="card overflow-hidden">
      <header className="border-b border-line bg-raised px-4 py-3">
        <h3 className="font-medium">{title}</h3>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

/** Horizontal bar list — used for both the level spread and species leaders. */
function BarList({
  rows,
}: {
  rows: { key: string; label: string; sub?: string; count: number }[];
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));

  return (
    <ul className="space-y-2.5 p-4">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_3rem] gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-sm" title={row.sub ?? row.label}>
                {row.label}
              </p>
            </div>
            <div className="meter mt-1.5" aria-hidden="true">
              <span style={{ width: `${(row.count / max) * 100}%` }} />
            </div>
          </div>
          <p className="text-right text-sm tabular-nums text-muted">
            {formatCount(row.count)}
          </p>
        </li>
      ))}
      {rows.length === 0 && (
        <li className="text-sm text-subtle">Nothing to chart in this save.</li>
      )}
    </ul>
  );
}

/**
 * Dashboard for a loaded session.
 *
 * Fetches `/overview` once per revision so it reflects edits without polling.
 */
export function SaveOverviewPanel({
  session,
  revision,
  onSelectPlayer,
}: {
  session: SaveSession;
  revision: number;
  onSelectPlayer?: (playerUid: string) => void;
}) {
  const [overview, setOverview] = useState<SaveOverview | null>(null);
  const [error, setError] = useState<string>();
  const [reloads, setReloads] = useState(0);
  const [settledKey, setSettledKey] = useState<string>();

  // A new revision means the summary is out of date. Deriving `loading` from
  // the key (rather than setting it inside the effect) keeps the first render
  // after an edit correct without a cascading re-render.
  const requestKey = `${session.id}:${revision}:${reloads}`;
  const loading = settledKey !== requestKey;

  useEffect(() => {
    const controller = new AbortController();

    void getSaveOverview(session.id, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setOverview(value);
        setError(undefined);
        setSettledKey(requestKey);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setSettledKey(requestKey);
      });

    return () => controller.abort();
  }, [session.id, requestKey]);

  if (loading && !overview) {
    return (
      <div className="card p-8 text-center text-sm text-muted">
        Building the world summary…
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="alert alert-danger" role="alert">
        <div className="space-y-2">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setReloads((value) => value + 1)}
            className="btn btn-secondary btn-sm"
          >
            <RefreshIcon className="size-3.5" />
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!overview) return null;

  const { characters, container } = {
    ...overview,
    container: session.container,
  };
  const ratio = session.originalSize
    ? session.decompressedSize / session.originalSize
    : 0;

  return (
    <div className="space-y-4">
      {error && (
        <p className="alert alert-warning text-sm" role="alert">
          Showing the previous summary — refresh failed: {error}
        </p>
      )}

      {/* Headline numbers */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Characters"
          value={formatCount(characters.total)}
          hint={`${formatCount(characters.pals)} Pals · ${formatCount(characters.players)} players`}
        />
        <Stat
          label="Distinct species"
          value={formatCount(characters.distinctSpecies)}
          hint={`Highest level ${formatCount(characters.maxPalLevel)}`}
        />
        <Stat
          label="Average Pal level"
          value={formatDecimal(characters.averagePalLevel)}
          hint={`${formatCount(characters.nicknamed)} nicknamed`}
        />
        <Stat
          label="Expanded size"
          value={formatFileSize(session.decompressedSize)}
          hint={`${formatFileSize(session.originalSize)} on disk · ${formatDecimal(ratio, 2)}× expansion`}
        />
      </div>

      {/* Container + parse health */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Container" hint="Decoded from the 12-byte save header">
          <dl className="divide-y divide-line text-sm">
            {[
              ["Magic", container.magic],
              ["Codec", container.compression],
              [
                "Type byte",
                `0x${container.saveType.toString(16).padStart(2, "0")}`,
              ],
              ["Save game type", overview.saveGameType],
              ["Engine", overview.engineVersion],
              ["GVAS version", String(overview.saveGameVersion)],
              ["Root properties", formatCount(overview.rootPropertyCount)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-3 px-4 py-2"
              >
                <dt className="text-muted">{label}</dt>
                <dd className="truncate font-mono text-xs" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section
          title="Parse coverage"
          hint="How much of the character map the editor fully understood"
        >
          <div className="space-y-4 p-4">
            {(
              [
                ["Complete", characters.complete, "bg-success"],
                ["Partial", characters.partial, "bg-warning"],
                ["Unsupported", characters.unsupported, "bg-danger"],
              ] as const
            ).map(([label, count, colour]) => {
              const share = characters.total
                ? (count / characters.total) * 100
                : 0;
              return (
                <div key={label}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted">{label}</span>
                    <span className="tabular-nums">
                      {formatCount(count)}{" "}
                      <span className="text-subtle">({share.toFixed(0)}%)</span>
                    </span>
                  </div>
                  <div className="meter mt-1.5">
                    <span
                      className={colour}
                      style={{ width: `${share}%`, backgroundImage: "none" }}
                    />
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-subtle">
              Partial rows are still listed and editable — only the fields the
              parser could not read are withheld.
            </p>
          </div>
        </Section>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Level distribution" hint="Pals only, players excluded">
          <BarList
            rows={overview.levelHistogram.map((bucket) => ({
              key: bucket.label,
              label: bucket.label,
              count: bucket.count,
            }))}
          />
        </Section>

        <Section title="Most common species" hint="Top 12 by head count">
          <BarList
            rows={overview.topSpecies.map((entry) => ({
              key: entry.characterId,
              label: humanizeId(entry.characterId),
              sub: entry.characterId,
              count: entry.count,
            }))}
          />
        </Section>
      </div>

      {/* Players and strongest */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Players"
          hint="Pal counts come from each Pal's OwnerPlayerUId"
        >
          <div className="scroll-slim max-h-72 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface text-xs text-subtle">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Player
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Lv
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Pals
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Save file
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.players.map((player) => (
                  <tr
                    key={player.playerUid || player.nickname}
                    className="border-t border-line"
                  >
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        disabled={!onSelectPlayer || !player.playerUid}
                        onClick={() => onSelectPlayer?.(player.playerUid)}
                        className="text-left enabled:hover:text-accent disabled:cursor-default"
                      >
                        <span className="font-medium">
                          {player.nickname ?? "Unnamed"}
                        </span>
                        <span
                          className="block font-mono text-xs text-subtle"
                          title={player.playerUid}
                        >
                          {shortId(player.playerUid)}
                        </span>
                      </button>
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {formatCount(player.level)}
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {formatCount(player.palCount)}
                    </td>
                    <td className="px-4 py-2">
                      {player.hasSaveFile ? (
                        <span className="badge badge-success">Uploaded</span>
                      ) : (
                        <span className="badge">Not uploaded</span>
                      )}
                    </td>
                  </tr>
                ))}
                {overview.players.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 text-sm text-subtle">
                      No player characters found in this world.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Highest level Pals"
          hint="Top 8 by level, then star rank"
        >
          <ul className="divide-y divide-line">
            {overview.strongest.map((pal) => (
              <li
                key={pal.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {pal.nickname ?? humanizeId(pal.characterId)}
                  </p>
                  <p className="truncate font-mono text-xs text-subtle">
                    {pal.characterId ?? pal.id}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {pal.rank !== undefined && pal.rank > 1 && (
                    <span className="badge badge-warning">
                      {"★".repeat(Math.max(0, Math.min(4, pal.rank - 1)))}
                    </span>
                  )}
                  <span className="badge badge-accent tabular-nums">
                    Lv {formatCount(pal.level)}
                  </span>
                </div>
              </li>
            ))}
            {overview.strongest.length === 0 && (
              <li className="px-4 py-4 text-sm text-subtle">
                No Pals with a readable level.
              </li>
            )}
          </ul>
        </Section>
      </div>

      {/* World collections */}
      <Section
        title="World collections"
        hint="Immediate children of worldSaveData, largest first"
      >
        <div className="scroll-slim max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface text-xs text-subtle">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Kind
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Size
                </th>
              </tr>
            </thead>
            <tbody>
              {overview.worldCollections.map((collection) => (
                <tr key={collection.name} className="border-t border-line">
                  <td className="px-4 py-2 font-mono text-xs break-all">
                    {collection.name}
                  </td>
                  <td className="px-2 py-2">
                    <span className={KIND_BADGE[collection.kind] ?? "badge"}>
                      {collection.kind}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {collection.entryCount !== undefined
                      ? `${formatCount(collection.entryCount)} entries`
                      : collection.byteLength !== undefined
                        ? formatFileSize(collection.byteLength)
                        : "—"}
                  </td>
                </tr>
              ))}
              {overview.worldCollections.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-4 text-sm text-subtle">
                    This save has no parsed worldSaveData struct.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
