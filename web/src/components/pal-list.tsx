"use client";

import { useEffect, useRef, useState } from "react";
import {
  bulkUpdatePals,
  getPal,
  getPals,
  getPlayerStats,
  getSaveSession,
  updatePal,
  PalSaveApiError,
  type GetPalsQuery,
  type PalDetail as PalDetailModel,
  type PalSummary,
  type SavePathSegment,
  type UpdatePalRequest,
} from "@/lib/palsave-api";
import { PalDetail } from "@/components/pal-detail";
import { BulkBar } from "@/components/bulk-bar";
import { updatePalRow } from "@/lib/pal-form";
import { humanizeId, shortId } from "@/lib/format";
import { WikiIcon } from "@/components/wiki-browser";
import { useSkillCatalog } from "@/lib/skill-catalog";
import {
  ELEMENT_COLORS,
  isAlpha,
  lookupSpecies,
  usePalCatalog,
} from "@/lib/pal-catalog";

const PAGE_SIZE = 50;

const PARSE_BADGE: Record<string, string> = {
  partial: "badge-warning",
  unsupported: "badge-danger",
};

/**
 * @deprecated until I figure out to do with it.
 *
 * A Pal's owner, named when the world's player list knows the UID.
 */
// eslint-disable-next-line
function OwnerCell({
  pal,
  names,
}: {
  pal: PalSummary;
  names: Map<string, string>;
}) {
  const uid = pal.ownerPlayerUid ?? pal.playerUid;
  if (!uid) return <p>Wild</p>;

  const name = names.get(uid.toLowerCase());
  return (
    <p title={uid} className={name ? "truncate" : "font-mono"}>
      {name ?? shortId(uid)}
    </p>
  );
}

export function PalList({
  sessionId,
  generation,
  refreshToken,
  onViewRawAction,
  revision,
  onSessionUpdateAction,
}: {
  sessionId: string;
  generation: number;
  refreshToken: number;
  onViewRawAction: (path: SavePathSegment[]) => void;
  revision: number;
  onSessionUpdateAction: (dirty: boolean, revision: number) => void;
}) {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const [minLevel, setMinLevel] = useState("");

  /** The world's players, so Pals can be narrowed to the one who owns them. */
  const [owners, setOwners] = useState<{ playerUid: string; label: string }[]>(
    [],
  );

  /** The page currently shown, tagged with the filters that produced it. */
  const [page, setPage] = useState<{
    key: string;
    items: PalSummary[];
    total: number;
    hasMore: boolean;
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [appending, setAppending] = useState(false);

  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<PalDetailModel | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();
  const [savingPal, setSavingPal] = useState(false);

  // Bulk selection + actions.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string>();
  const [refreshTick, setRefreshTick] = useState(0);

  const detailController = useRef<AbortController | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const catalog = usePalCatalog();
  const { passive: passiveOptions } = useSkillCatalog();

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  useEffect(() => {
    const controller = new AbortController();

    void getPlayerStats(sessionId, controller.signal)
      .then((players) => {
        if (controller.signal.aborted) return;
        setOwners(
          players
            .filter((player) => player.playerUid)
            .map((player) => ({
              playerUid: player.playerUid!,
              label: player.nickname || shortId(player.playerUid!),
            })),
        );
      })
      // Owner filtering is a convenience; the list still works without it.
      .catch(() => {
        if (!controller.signal.aborted) setOwners([]);
      });

    return () => controller.abort();
  }, [sessionId]);

  const parsedMinLevel = minLevel.trim() === "" ? undefined : Number(minLevel);
  const minLevelFilter =
    parsedMinLevel !== undefined && Number.isFinite(parsedMinLevel)
      ? parsedMinLevel
      : undefined;

  const filters: GetPalsQuery = {
    limit: PAGE_SIZE,
    search: search || undefined,
    ownerPlayerUid: owner || undefined,
    minLevel: minLevelFilter,
  };

  // Identifies the current filter set. Results carry the key they were fetched
  // for, so a page from stale filters is simply ignored instead of rendered.
  // `refreshTick` lets a bulk apply force a refetch of the same filters.
  const listKey = JSON.stringify([
    sessionId,
    generation,
    refreshToken,
    refreshTick,
    filters,
  ]);

  // Owner UIDs are opaque; the players list is what gives them names.
  const ownerNames = new Map(
    owners.map((entry) => [entry.playerUid.toLowerCase(), entry.label]),
  );

  const current = page?.key === listKey ? page : null;
  const items = current?.items ?? [];
  const total = current?.total ?? 0;
  const hasMore = current?.hasMore ?? false;
  const error = failure?.key === listKey ? failure.message : undefined;
  const loading = !current && !error;

  useEffect(() => {
    const controller = new AbortController();

    void getPals(sessionId, { ...filters, offset: 0 }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setPage({
          key: listKey,
          items: response.items,
          total: response.total,
          hasMore: response.hasMore,
        });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setFailure({
          key: listKey,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });

    return () => controller.abort();
    // `listKey` already encodes every input to the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, sessionId]);

  // Drop the selection whenever the filter set (not pagination) changes.
  useEffect(() => {
    setSelectedIds(new Set()); // eslint-disable-line react-hooks/set-state-in-effect
  }, [search, owner, minLevelFilter, sessionId]);

  useEffect(() => () => detailController.current?.abort(), []);

  async function loadMore() {
    if (loading || appending || !hasMore) return;
    setAppending(true);

    try {
      const response = await getPals(sessionId, {
        ...filters,
        offset: items.length,
      });
      setPage((state) =>
        state?.key === listKey
          ? {
              key: listKey,
              items: [...state.items, ...response.items],
              total: response.total,
              hasMore: response.hasMore,
            }
          : state,
      );
    } catch (cause) {
      setFailure({
        key: listKey,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setAppending(false);
    }
  }

  async function selectPal(pal: PalSummary) {
    setSelectedId(pal.id);
    setDetail(null);
    setDetailError(undefined);
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setDetailLoading(true);

    try {
      const response = await getPal(sessionId, pal.id, controller.signal);
      if (!controller.signal.aborted) setDetail(response);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setDetailError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }

  async function savePal(update: UpdatePalRequest) {
    setSavingPal(true);
    try {
      const response = await updatePal(sessionId, selectedId!, update);
      setDetail(response.pal);
      // Keep the row in sync without refetching the whole page.
      setPage((state) =>
        state
          ? { ...state, items: updatePalRow(state.items, response.pal) }
          : state,
      );
      onSessionUpdateAction(response.dirty, response.revision);
      return response.pal;
    } catch (cause) {
      if (cause instanceof PalSaveApiError && cause.status === 409) {
        const metadata = await getSaveSession(sessionId);
        onSessionUpdateAction(metadata.dirty, metadata.revision);
      }
      throw cause;
    } finally {
      setSavingPal(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allShownSelected =
    items.length > 0 && items.every((pal) => selectedIds.has(pal.id));

  function toggleAllShown() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (items.every((pal) => prev.has(pal.id))) {
        items.forEach((pal) => next.delete(pal.id));
      } else {
        items.forEach((pal) => next.add(pal.id));
      }
      return next;
    });
  }

  async function applyBulk(
    fields: Record<string, { value: number }>,
    addPassiveSkills: string[],
  ) {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const response = await bulkUpdatePals(sessionId, {
        expectedRevision: revision,
        ids: [...selectedIds],
        fields,
        addPassiveSkills,
      });
      onSessionUpdateAction(response.dirty, response.revision);
      setSelectedIds(new Set());
      setRefreshTick((tick) => tick + 1); // refetch so rows show new values
      const msg =
        response.failed === 0
          ? `${response.succeeded} Pal${response.succeeded === 1 ? "" : "s"} updated`
          : `${response.succeeded} updated · ${response.failed} skipped`;
      window.clearTimeout(noticeTimer.current);
      setBulkNotice(msg);
      noticeTimer.current = window.setTimeout(
        () => setBulkNotice(undefined),
        4000,
      );
    } catch (cause) {
      setFailure({
        key: listKey,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="card grid min-h-128 lg:h-168 overflow-hidden lg:grid-rows-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(22rem,0.9fr)]">
      <section
        className="flex min-h-0 min-w-0 flex-col border-b border-line lg:border-b-0 lg:border-r"
        aria-label="Pal list"
      >
        <div className="space-y-3 border-b border-line p-4">
          <label className="block">
            <span className="field-label" id="pal-search-label">
              Search species, nickname or instance ID
            </span>
            <input
              id="pal-search"
              type="search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="e.g. Frostallion"
              className="field"
            />
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="w-28">
              <span className="field-label">Min level</span>
              <input
                type="number"
                min={1}
                max={255}
                value={minLevel}
                onChange={(event) => setMinLevel(event.target.value)}
                placeholder="any"
                className="field field-sm tabular-nums"
              />
            </label>

            {owners.length > 0 && (
              <label className="w-44">
                <span className="field-label">Owner</span>
                <select
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  className="field field-sm"
                >
                  <option value="">Any owner</option>
                  {owners.map((entry) => (
                    <option key={entry.playerUid} value={entry.playerUid}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <p className="ml-auto pb-1.5 text-xs text-subtle">
              {total.toLocaleString()} {total === 1 ? "Pal" : "Pals"}
            </p>
          </div>
        </div>

        {bulkNotice && (
          <p
            role="status"
            className="border-b border-line px-4 py-2 text-xs"
            style={{
              color: bulkNotice.includes("skipped")
                ? "var(--color-warning)"
                : "var(--color-success)",
            }}
          >
            {bulkNotice}
          </p>
        )}

        {loading && items.length === 0 && (
          <p className="p-4 text-sm text-muted" role="status">
            Building the Pal index…
          </p>
        )}
        {error && (
          <p className="p-4 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && items.length === 0 && (
          <p className="p-4 text-sm text-subtle">
            No Pals match these filters.
          </p>
        )}

        {items.length > 0 && (
          <label className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs text-subtle">
            <input
              type="checkbox"
              checked={allShownSelected}
              onChange={toggleAllShown}
              className="size-4"
            />
            Select all shown ({items.length})
          </label>
        )}

        {items.length > 0 && (
          <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
            <ul className="divide-y divide-line">
              {items.map((pal) => {
                const sp = lookupSpecies(catalog, pal.characterId);
                const alpha = isAlpha(pal.characterId);
                const stars =
                  pal.rank !== undefined ? Math.max(0, pal.rank - 1) : 0;
                const el0 = sp?.elements?.[0];
                const ownerUid = pal.ownerPlayerUid ?? pal.playerUid;
                const ownerName = ownerUid
                  ? ownerNames.get(ownerUid.toLowerCase())
                  : undefined;
                const selected = selectedId === pal.id;
                return (
                  <li key={pal.id} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(pal.id)}
                      onChange={() => toggleSelect(pal.id)}
                      aria-label={`Select ${pal.nickname || humanizeId(pal.characterId)}`}
                      className="ml-3 size-4 shrink-0"
                    />
                    <button
                      type="button"
                      aria-current={selected || undefined}
                      onClick={() => {
                        if (!savingPal) void selectPal(pal);
                      }}
                      className={`flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                        selected ? "bg-accent-soft" : "hover:bg-raised"
                      }`}
                    >
                      <span
                        className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-sunken"
                        style={
                          el0
                            ? {
                                boxShadow: `inset 0 0 0 1.5px ${ELEMENT_COLORS[el0]}66`,
                              }
                            : undefined
                        }
                      >
                        {sp?.icon ? (
                          <WikiIcon icon={sp.icon} alt="" className="size-11" />
                        ) : (
                          <span className="text-sm text-subtle">
                            {(
                              pal.nickname ||
                              humanizeId(pal.characterId) ||
                              "?"
                            ).slice(0, 1)}
                          </span>
                        )}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium">
                            {pal.nickname ||
                              sp?.name ||
                              humanizeId(pal.characterId)}
                          </span>
                          {alpha && (
                            <span
                              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                              style={{
                                color: "#f0733b",
                                background: "#f0733b1f",
                              }}
                            >
                              Alpha
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          {pal.nickname && sp?.name && (
                            <span className="truncate text-xs text-subtle">
                              {sp.name}
                            </span>
                          )}
                          {sp?.elements?.map((el) => (
                            <span
                              key={el}
                              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                color:
                                  ELEMENT_COLORS[el] ?? "var(--color-subtle)",
                                background: `${ELEMENT_COLORS[el] ?? "#888"}1f`,
                              }}
                            >
                              {el}
                            </span>
                          ))}
                          {ownerName && (
                            <span className="hidden truncate text-xs text-subtle md:inline">
                              · {ownerName}
                            </span>
                          )}
                        </span>
                      </span>

                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-medium tabular-nums">
                          Lv {pal.level ?? "—"}
                        </span>
                        {stars > 0 && (
                          <span
                            className="text-xs"
                            style={{ color: "#e6c53a" }}
                            aria-label={`${stars} stars`}
                          >
                            {"★".repeat(stars)}
                          </span>
                        )}
                        {pal.parseStatus !== "complete" && (
                          <span
                            className={`${PARSE_BADGE[pal.parseStatus]} mt-1 block`}
                          >
                            {pal.parseStatus === "partial"
                              ? "Partial"
                              : "Unsupported"}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {hasMore && (
              <div className="border-t border-line p-3 text-center">
                <button
                  type="button"
                  disabled={appending}
                  onClick={() => void loadMore()}
                  className="btn btn-secondary btn-sm"
                >
                  {appending
                    ? "Loading…"
                    : `Load more (${items.length.toLocaleString()} / ${total.toLocaleString()})`}
                </button>
              </div>
            )}
          </div>
        )}

        {selectedIds.size > 0 && (
          <BulkBar
            count={selectedIds.size}
            passiveOptions={passiveOptions}
            busy={bulkBusy}
            onApplyAction={applyBulk}
            onClearAction={() => setSelectedIds(new Set())}
          />
        )}
      </section>

      <PalDetail
        key={selectedId + (detail ? ":loaded" : ":pending")}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        revision={revision}
        onSaveAction={savePal}
        onViewRawAction={(selected) => onViewRawAction(selected.rawPath)}
      />
    </div>
  );
}
