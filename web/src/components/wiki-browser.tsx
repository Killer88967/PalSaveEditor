"use client";

import { useEffect, useMemo, useState } from "react";
import {
  loadWikiData,
  wikiIconUrl,
  type WikiDataSet,
  type WikiDataSets,
} from "@/lib/wiki";

/** Game art, with a graceful hole when an icon was not in the dump. */
export function WikiIcon({
  icon,
  alt,
  className = "size-8",
}: {
  icon?: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = wikiIconUrl(icon);

  if (!url || failed) {
    return (
      <span
        aria-hidden="true"
        className={`${className} shrink-0 rounded-md bg-sunken`}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static local art, no optimiser needed
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`${className} shrink-0 object-contain`}
    />
  );
}

export interface WikiFilter {
  id: string;
  label: string;
  icon?: string;
  color?: string;
}

export interface WikiSort<T> {
  id: string;
  label: string;
  compare: (a: T, b: T) => number;
}

/**
 * Master/detail browser shared by every category page: a searchable, filterable
 * list on the left and the selected entry on the right.
 */
export function WikiBrowser<K extends WikiDataSet>({
  set,
  searchPlaceholder,
  keyOfAction,
  matchesAction,
  filters,
  passesFilterAction,
  sorts,
  renderRowAction,
  renderDetailAction,
  emptyDetail,
}: {
  set: K;
  searchPlaceholder: string;
  keyOfAction: (entry: WikiDataSets[K][number]) => string;
  matchesAction: (entry: WikiDataSets[K][number], query: string) => boolean;
  filters?: WikiFilter[];
  passesFilterAction?: (
    entry: WikiDataSets[K][number],
    filter: string,
  ) => boolean;
  sorts?: WikiSort<WikiDataSets[K][number]>[];
  renderRowAction: (entry: WikiDataSets[K][number]) => React.ReactNode;
  renderDetailAction: (entry: WikiDataSets[K][number]) => React.ReactNode;
  emptyDetail: string;
}) {
  type Entry = WikiDataSets[K][number];

  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState(sorts?.[0]?.id ?? "");
  const [selected, setSelected] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    loadWikiData(set)
      .then((value) => {
        if (cancelled) return;
        setEntries(value as Entry[]);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError((cause as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [set]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    let result = entries;

    if (filter !== "all" && passesFilterAction) {
      result = result.filter((entry) => passesFilterAction(entry, filter));
    }
    if (query) {
      result = result.filter((entry) => matchesAction(entry, query));
    }

    const compare = sorts?.find((option) => option.id === sort)?.compare;

    return compare ? [...result].sort(compare) : result;
  }, [entries, search, filter, sort, matchesAction, passesFilterAction, sorts]);

  const current =
    visible.find((entry) => keyOfAction(entry) === selected) ?? visible[0];

  if (error) {
    return (
      <p className="alert alert-danger text-sm" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="card flex min-h-0 flex-col overflow-hidden">
        <div className="space-y-2 border-b border-line p-3">
          <input
            type="search"
            value={search}
            placeholder={searchPlaceholder}
            onChange={(event) => setSearch(event.target.value)}
            className="field field-sm"
            aria-label={searchPlaceholder}
          />

          {filters && filters.length > 0 && (
            <div className="scroll-slim flex flex-wrap gap-1">
              {[{ id: "all", label: "All" }, ...filters].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  aria-pressed={filter === option.id}
                  className={`badge transition-colors ${
                    filter === option.id
                      ? "badge-accent"
                      : "hover:text-foreground"
                  }`}
                  style={
                    filter === option.id && "color" in option && option.color
                      ? { color: option.color as string }
                      : undefined
                  }
                >
                  {"icon" in option && option.icon && (
                    <WikiIcon
                      icon={option.icon as string}
                      alt=""
                      className="size-3.5"
                    />
                  )}
                  {option.label}
                </button>
              ))}
            </div>
          )}

          {sorts && sorts.length > 1 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs text-subtle">Sort</span>
              {sorts.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSort(option.id)}
                  aria-pressed={sort === option.id}
                  className={`badge transition-colors ${
                    sort === option.id
                      ? "badge-accent"
                      : "hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          <p className="text-xs text-subtle" role="status">
            {loading
              ? "Loading…"
              : `${visible.length} of ${entries.length} shown`}
          </p>
        </div>

        <ul className="scroll-slim max-h-136 overflow-y-auto p-1.5">
          {visible.slice(0, 400).map((entry) => {
            const key = keyOfAction(entry);
            const active = current && keyOfAction(current) === key;

            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setSelected(key)}
                  aria-current={active ? "true" : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                    active
                      ? "bg-accent-soft text-accent"
                      : "hover:bg-raised hover:text-foreground"
                  }`}
                >
                  {renderRowAction(entry)}
                </button>
              </li>
            );
          })}

          {!loading && visible.length === 0 && (
            <li className="p-4 text-center text-sm text-subtle">
              Nothing matches that search.
            </li>
          )}
          {visible.length > 400 && (
            <li className="p-2 text-center text-xs text-subtle">
              Showing the first 400 — narrow the search to see the rest.
            </li>
          )}
        </ul>
      </div>

      <div className="card scroll-slim max-h-168 overflow-y-auto p-4">
        {current ? (
          renderDetailAction(current)
        ) : (
          <p className="p-6 text-center text-sm text-subtle">
            {loading ? "Loading…" : emptyDetail}
          </p>
        )}
      </div>
    </div>
  );
}

/** Small labelled figure used all over the detail panels. */
export function Stat({
  label,
  value,
}: {
  label: string;
  value?: React.ReactNode;
}) {
  return (
    <div className="panel p-2.5">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="mt-0.5 wrap-break-word text-sm tabular-nums">
        {value ?? "—"}
      </dd>
    </div>
  );
}

export function DetailHeader({
  icon,
  name,
  id,
  badges,
  description,
}: {
  icon?: string | null;
  name: string;
  id: string;
  badges?: React.ReactNode;
  description?: string;
}) {
  return (
    <header className="flex items-start gap-3">
      <WikiIcon icon={icon} alt={name} className="size-14" />
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{name}</h2>
        <p className="truncate font-mono text-xs text-subtle" title={id}>
          {id}
        </p>
        {badges && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">{badges}</div>
        )}
        {description && (
          <p className="mt-2 text-sm text-muted">{description}</p>
        )}
      </div>
    </header>
  );
}
