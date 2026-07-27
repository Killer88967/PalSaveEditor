"use client";

import { useEffect, useRef, useState } from "react";
import {
  getPal,
  getPals,
  type PalDetail as PalDetailModel,
  type PalSummary,
  type SavePathSegment,
} from "@/lib/palsave-api";
import { PalDetail } from "@/components/pal-detail";

const PAGE_SIZE = 50;

function shortId(value?: string) {
  if (!value) return "—";
  return value.length > 15 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function PalList({
  sessionId,
  generation,
  refreshToken,
  onViewRaw,
}: {
  sessionId: string;
  generation: number;
  refreshToken: number;
  onViewRaw: (path: SavePathSegment[]) => void;
}) {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<PalSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<PalDetailModel | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();
  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const request = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    const requestId = ++request.current;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    const start = window.setTimeout(() => {
      setLoading(true);
      setError(undefined);
      setItems([]);
      setTotal(0);
      setHasMore(false);
      void getPals(
        sessionId,
        { offset: 0, limit: PAGE_SIZE, search: search || undefined },
        controller.signal,
      )
        .then((response) => {
          if (request.current !== requestId || controller.signal.aborted)
            return;
          setItems(response.items);
          setTotal(response.total);
          setHasMore(response.hasMore);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted && request.current === requestId)
            setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!controller.signal.aborted && request.current === requestId)
            setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(start);
      controller.abort();
    };
  }, [generation, refreshToken, search, sessionId]);

  useEffect(
    () => () => {
      listController.current?.abort();
      detailController.current?.abort();
    },
    [],
  );

  async function loadMore() {
    if (loading || !hasMore) return;
    const requestId = request.current;
    const controller = new AbortController();
    listController.current = controller;
    setLoading(true);
    setError(undefined);
    try {
      const response = await getPals(
        sessionId,
        { offset: items.length, limit: PAGE_SIZE, search: search || undefined },
        controller.signal,
      );
      if (request.current !== requestId || controller.signal.aborted) return;
      setItems((current) => [...current, ...response.items]);
      setTotal(response.total);
      setHasMore(response.hasMore);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
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
      if (!controller.signal.aborted)
        setDetailError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }

  return (
    <div className="grid min-h-96 overflow-hidden rounded border border-neutral-800 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.85fr)]">
      <section className="border-b border-neutral-800 lg:border-r lg:border-b-0">
        <div className="space-y-2 border-b border-neutral-800 p-3">
          <label
            className="block text-xs font-medium text-neutral-400"
            htmlFor="pal-search"
          >
            Search species, nickname, or instance ID
          </label>
          <input
            id="pal-search"
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="e.g. Frostallion"
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-sky-600"
          />
          <p className="text-xs text-neutral-500">
            {total.toLocaleString()} {total === 1 ? "character" : "characters"}
          </p>
        </div>

        {loading && items.length === 0 && (
          <p className="p-4 text-sm text-neutral-400">Building Pal index…</p>
        )}
        {error && <p className="p-4 text-sm text-red-400">❌ {error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="p-4 text-sm text-neutral-500">
            No Pals match this search.
          </p>
        )}
        {items.length > 0 && (
          <div className="max-h-136 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-neutral-950 text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Pal</th>
                  <th className="px-2 py-2 font-medium">Lv / rank</th>
                  <th className="hidden px-2 py-2 font-medium sm:table-cell">
                    Gender
                  </th>
                  <th className="hidden px-2 py-2 font-medium md:table-cell">
                    Owner / instance
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((pal) => (
                  <tr
                    key={pal.id}
                    aria-selected={selectedId === pal.id}
                    onClick={() => void selectPal(pal)}
                    className={`cursor-pointer border-t border-neutral-900 hover:bg-neutral-900 ${
                      selectedId === pal.id ? "bg-sky-950/50" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <p className="font-medium text-neutral-100">
                        {pal.nickname || pal.characterId || "Unknown"}
                      </p>
                      {pal.nickname && (
                        <p className="text-neutral-500">{pal.characterId}</p>
                      )}
                      {pal.parseStatus !== "complete" && (
                        <span className="text-amber-400">
                          {pal.parseStatus === "partial"
                            ? "Partial data"
                            : "Unsupported entry"}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {pal.level ?? "—"} / {pal.rank ?? "—"}
                    </td>
                    <td className="hidden px-2 py-2 sm:table-cell">
                      {pal.gender || "—"}
                    </td>
                    <td className="hidden px-2 py-2 font-mono text-neutral-500 md:table-cell">
                      <p title={pal.ownerPlayerUid}>
                        {shortId(pal.ownerPlayerUid)}
                      </p>
                      <p title={pal.instanceId}>{shortId(pal.instanceId)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore && (
              <div className="border-t border-neutral-800 p-3 text-center">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void loadMore()}
                  className="rounded border border-neutral-700 px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  {loading
                    ? "Loading…"
                    : `Load more (${items.length}/${total})`}
                </button>
              </div>
            )}
          </div>
        )}
      </section>
      <PalDetail
        detail={detail}
        loading={detailLoading}
        error={detailError}
        onViewRaw={(selected) => onViewRaw(selected.rawPath)}
      />
    </div>
  );
}
