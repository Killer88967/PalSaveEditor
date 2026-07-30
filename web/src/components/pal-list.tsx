"use client";

import { useEffect, useRef, useState } from "react";
import {
  getPal,
  getPals,
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
import { updatePalRow } from "@/lib/pal-form";
import { humanizeId, shortId } from "@/lib/format";

const PAGE_SIZE = 50;

const PARSE_BADGE: Record<string, string> = {
  partial: "badge-warning",
  unsupported: "badge-danger",
};

export function PalList({
  sessionId,
  generation,
  refreshToken,
  onViewRaw,
  revision,
  onSessionUpdate,
}: {
  sessionId: string;
  generation: number;
  refreshToken: number;
  onViewRaw: (path: SavePathSegment[]) => void;
  revision: number;
  onSessionUpdate: (dirty: boolean, revision: number) => void;
}) {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [includePlayers, setIncludePlayers] = useState(false);
  const [minLevel, setMinLevel] = useState("");

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

  const detailController = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  const parsedMinLevel = minLevel.trim() === "" ? undefined : Number(minLevel);
  const minLevelFilter =
    parsedMinLevel !== undefined && Number.isFinite(parsedMinLevel)
      ? parsedMinLevel
      : undefined;

  const filters: GetPalsQuery = {
    limit: PAGE_SIZE,
    search: search || undefined,
    includePlayers: includePlayers || undefined,
    minLevel: minLevelFilter,
  };

  // Identifies the current filter set. Results carry the key they were fetched
  // for, so a page from stale filters is simply ignored instead of rendered.
  const listKey = JSON.stringify([
    sessionId,
    generation,
    refreshToken,
    filters,
  ]);

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
      onSessionUpdate(response.dirty, response.revision);
      return response.pal;
    } catch (cause) {
      if (cause instanceof PalSaveApiError && cause.status === 409) {
        const metadata = await getSaveSession(sessionId);
        onSessionUpdate(metadata.dirty, metadata.revision);
      }
      throw cause;
    } finally {
      setSavingPal(false);
    }
  }

  return (
    <div className="card grid min-h-[32rem] overflow-hidden lg:grid-cols-[minmax(0,1.3fr)_minmax(22rem,0.9fr)]">
      <section
        className="flex min-w-0 flex-col border-b border-line lg:border-b-0 lg:border-r"
        aria-label="Character list"
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

            <label className="flex items-center gap-2 pb-1.5 text-sm text-muted">
              <input
                type="checkbox"
                checked={includePlayers}
                onChange={(event) => setIncludePlayers(event.target.checked)}
                className="accent-[var(--accent)]"
              />
              Include players
            </label>

            <p className="ml-auto pb-1.5 text-xs text-subtle">
              {total.toLocaleString()}{" "}
              {total === 1 ? "character" : "characters"}
            </p>
          </div>
        </div>

        {loading && items.length === 0 && (
          <p className="p-4 text-sm text-muted" role="status">
            Building the character index…
          </p>
        )}
        {error && (
          <p className="p-4 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && items.length === 0 && (
          <p className="p-4 text-sm text-subtle">
            No characters match these filters.
          </p>
        )}

        {items.length > 0 && (
          <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface text-xs text-subtle">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Character
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Lv / ★
                  </th>
                  <th
                    scope="col"
                    className="hidden px-2 py-2 font-medium sm:table-cell"
                  >
                    Gender
                  </th>
                  <th
                    scope="col"
                    className="hidden px-4 py-2 font-medium md:table-cell"
                  >
                    Owner
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((pal) => (
                  <tr
                    key={pal.id}
                    aria-selected={selectedId === pal.id}
                    tabIndex={0}
                    onClick={() => {
                      if (!savingPal) void selectPal(pal);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !savingPal) {
                        void selectPal(pal);
                      }
                    }}
                    className={`cursor-pointer border-t border-line transition-colors ${
                      selectedId === pal.id
                        ? "bg-accent-soft"
                        : "hover:bg-raised"
                    }`}
                  >
                    <td className="px-4 py-2">
                      <p className="flex items-center gap-1.5 font-medium">
                        <span className="truncate">
                          {pal.nickname || humanizeId(pal.characterId)}
                        </span>
                        {pal.isPlayer && (
                          <span className="badge shrink-0">Player</span>
                        )}
                      </p>
                      <p className="truncate font-mono text-xs text-subtle">
                        {pal.characterId ?? pal.id}
                      </p>
                      {pal.parseStatus !== "complete" && (
                        <span
                          className={`${PARSE_BADGE[pal.parseStatus]} mt-1`}
                        >
                          {pal.parseStatus === "partial"
                            ? "Partial data"
                            : "Unsupported"}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                      {pal.level ?? "—"}
                      <span className="text-subtle"> / </span>
                      {pal.rank !== undefined ? pal.rank - 1 : "—"}
                    </td>
                    <td className="hidden px-2 py-2 sm:table-cell">
                      {pal.gender || "—"}
                    </td>
                    <td className="hidden px-4 py-2 font-mono text-xs text-subtle md:table-cell">
                      <p title={pal.ownerPlayerUid ?? pal.playerUid}>
                        {shortId(pal.ownerPlayerUid ?? pal.playerUid) === "—"
                          ? "Wild"
                          : shortId(pal.ownerPlayerUid ?? pal.playerUid)}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

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
      </section>

      <PalDetail
        key={selectedId + (detail ? ":loaded" : ":pending")}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        revision={revision}
        onSave={savePal}
        onViewRaw={(selected) => onViewRaw(selected.rawPath)}
      />
    </div>
  );
}
