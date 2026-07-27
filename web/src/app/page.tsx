"use client";

import { useRef, useState } from "react";
import {
  createSaveSession,
  deleteSaveSession,
  exportSaveSession,
  getSaveRoot,
  getSaveSession,
  inspectSaveNode,
  PalSaveApiError,
  updateSaveScalar,
  type EditableScalarValue,
  type SaveNodeResponse,
  type SaveNodeSummary,
  type SavePathSegment,
  type SaveSession,
} from "@/lib/palsave-api";

const PAGE_SIZE = 100;
interface LoadedNode {
  children: SaveNodeSummary[];
  hasMore: boolean;
  totalChildren: number;
  loading: boolean;
  error?: string;
}
const pathKey = (path: SavePathSegment[]) => JSON.stringify(path);
const previewText = (node: SaveNodeSummary) =>
  node.value
    ? typeof node.value.value === "string"
      ? JSON.stringify(node.value.value)
      : String(node.value.value)
    : node.preview === undefined
      ? null
      : typeof node.preview === "string"
        ? JSON.stringify(node.preview)
        : String(node.preview);

function scalarFromInput(
  value: EditableScalarValue,
  input: string,
  checked: boolean,
): EditableScalarValue {
  if (value.type === "bool") return { type: "bool", value: checked };
  if (["string", "name", "enum", "int64", "uInt64"].includes(value.type)) {
    if (
      (value.type === "int64" || value.type === "uInt64") &&
      !/^-?\d+$/.test(input)
    )
      throw new Error("Enter a base-10 integer.");
    return { type: value.type, value: input } as EditableScalarValue;
  }
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) throw new Error("Enter a finite number.");
  if (!["float", "double"].includes(value.type) && !Number.isInteger(parsed))
    throw new Error("Enter a whole number.");
  return { type: value.type, value: parsed } as EditableScalarValue;
}

function TreeNode({
  node,
  depth,
  sessionId,
  expanded,
  loaded,
  onToggle,
  onLoadMore,
  onSave,
}: {
  node: SaveNodeSummary;
  depth: number;
  sessionId: string;
  expanded: Set<string>;
  loaded: Record<string, LoadedNode>;
  onToggle: (id: string, node: SaveNodeSummary) => void;
  onLoadMore: (id: string, node: SaveNodeSummary) => void;
  onSave: (node: SaveNodeSummary, value: EditableScalarValue) => Promise<void>;
}) {
  const key = pathKey(node.path),
    state = loaded[key],
    isExpanded = expanded.has(key),
    expandable = (node.childCount ?? 0) > 0;
  const [editing, setEditing] = useState(false),
    [input, setInput] = useState(""),
    [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false),
    [error, setError] = useState<string>();
  function beginEdit() {
    if (!node.value) return;
    setInput(String(node.value.value));
    setChecked(node.value.type === "bool" && node.value.value);
    setError(undefined);
    setEditing(true);
  }
  async function save() {
    if (!node.value || submitting) return;
    setError(undefined);
    try {
      const next = scalarFromInput(node.value, input, checked);
      setSubmitting(true);
      await onSave(node, next);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <li>
      <div
        className="flex min-w-0 flex-wrap items-center gap-1 py-0.5"
        style={{ paddingLeft: depth * 16 }}
      >
        {expandable ? (
          <button
            type="button"
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.displayName}`}
            onClick={() => onToggle(sessionId, node)}
            className="w-5 shrink-0 text-neutral-400 hover:text-white"
          >
            {isExpanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <code className="break-all">{node.displayName}</code>
        <span className="shrink-0 text-neutral-500">— {node.kind}</span>
        {node.childCount !== undefined && (
          <span className="shrink-0 text-neutral-600">
            ({node.childCount.toLocaleString()})
          </span>
        )}
        {editing && node.value ? (
          <>
            {node.value.type === "bool" ? (
              <input
                aria-label={`Value for ${node.displayName}`}
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
            ) : (
              <input
                aria-label={`Value for ${node.displayName}`}
                className="min-w-36 rounded border border-neutral-700 bg-neutral-900 px-1 text-sky-200"
                type={
                  ["string", "name", "enum", "int64", "uInt64"].includes(
                    node.value.type,
                  )
                    ? "text"
                    : "number"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            )}
            <button
              disabled={submitting}
              onClick={() => void save()}
              className="rounded bg-sky-700 px-2 text-xs disabled:opacity-40"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
            <button
              disabled={submitting}
              onClick={() => {
                setEditing(false);
                setError(undefined);
              }}
              className="rounded border border-neutral-700 px-2 text-xs"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {previewText(node) !== null && (
              <span className="min-w-0 truncate text-sky-300">
                = {previewText(node)}
              </span>
            )}
            {node.editable && (
              <button
                onClick={beginEdit}
                className="rounded border border-neutral-700 px-2 text-xs"
              >
                Edit
              </button>
            )}
          </>
        )}
        {node.byteLength !== undefined && (
          <span className="shrink-0 text-amber-300">
            {formatFileSize(node.byteLength)}
          </span>
        )}
        {error && <span className="basis-full pl-6 text-red-400">{error}</span>}
      </div>
      {isExpanded && (
        <>
          {state?.loading && <p className="ml-8 text-neutral-500">Loading…</p>}
          {state?.error && (
            <p className="ml-8 text-red-400">
              {state.error}{" "}
              <button
                className="underline"
                onClick={() => onLoadMore(sessionId, node)}
              >
                Retry
              </button>
            </p>
          )}
          {state && !state.error && (
            <ul>
              {state.children.map((child) => (
                <TreeNode
                  key={pathKey(child.path)}
                  node={child}
                  depth={depth + 1}
                  sessionId={sessionId}
                  expanded={expanded}
                  loaded={loaded}
                  onToggle={onToggle}
                  onLoadMore={onLoadMore}
                  onSave={onSave}
                />
              ))}
              {state.hasMore && (
                <li style={{ paddingLeft: (depth + 2) * 16 }}>
                  <button
                    disabled={state.loading}
                    onClick={() => onLoadMore(sessionId, node)}
                    className="mt-1 rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-40"
                  >
                    {state.loading
                      ? "Loading…"
                      : `Load more (${state.children.length}/${state.totalChildren})`}
                  </button>
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

function formatFileSize(bytes: number) {
  if (!bytes) return "0 bytes";
  const units = ["bytes", "KB", "MB", "GB"],
    i = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1,
    );
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}
function roundtripFileName(name: string) {
  const base = name.toLowerCase().endsWith(".sav") ? name.slice(0, -4) : name;
  return `${base || "Level"}.roundtrip.sav`;
}
function updateSummary(
  node: SaveNodeSummary,
  path: SavePathSegment[],
  value: EditableScalarValue,
): SaveNodeSummary {
  return pathKey(node.path) === pathKey(path)
    ? {
        ...node,
        value,
        preview: typeof value.value === "string" ? value.value : value.value,
      }
    : node;
}

export default function Home() {
  const [status, setStatus] = useState("Pick a .sav file to parse."),
    [session, setSession] = useState<SaveSession | null>(null);
  const [root, setRoot] = useState<SaveNodeResponse | null>(null),
    [rootError, setRootError] = useState<string | null>(null);
  const [isLoadingRoot, setIsLoadingRoot] = useState(false),
    [isExporting, setIsExporting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()),
    [loaded, setLoaded] = useState<Record<string, LoadedNode>>({});
  const generation = useRef(0),
    controllers = useRef<Set<AbortController>>(new Set());
  const active = (g: number) => generation.current === g;
  function controller() {
    const c = new AbortController();
    controllers.current.add(c);
    return c;
  }
  function finish(c: AbortController) {
    controllers.current.delete(c);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    generation.current += 1;
    const g = generation.current;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    const previous = session;
    setSession(null);
    setRoot(null);
    setRootError(null);
    setIsLoadingRoot(false);
    setExpanded(new Set());
    setLoaded({});
    if (previous)
      void deleteSaveSession(previous.id).catch((error) =>
        console.warn("Failed to delete previous save session:", error),
      );
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus(`Reading ${file.name}…`);
    const c = controller();
    try {
      const created = await createSaveSession(file, c.signal);
      if (!active(g)) {
        void deleteSaveSession(created.id);
        return;
      }
      setSession(created);
      setStatus(`✅ Opened ${created.fileName} in Rust`);
      setIsLoadingRoot(true);
      try {
        const response = await getSaveRoot(created.id, c.signal);
        if (active(g)) setRoot(response);
      } catch (error) {
        if (
          active(g) &&
          !(error instanceof DOMException && error.name === "AbortError")
        )
          setRootError(String(error));
      } finally {
        if (active(g)) setIsLoadingRoot(false);
      }
    } catch (error) {
      if (
        active(g) &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        setStatus(`❌ ${String(error)}`);
    } finally {
      finish(c);
    }
  }

  async function loadNode(id: string, node: SaveNodeSummary, offset: number) {
    const g = generation.current,
      key = pathKey(node.path),
      c = controller();
    setLoaded((cur) => ({
      ...cur,
      [key]: {
        ...(cur[key] ?? {
          children: [],
          hasMore: false,
          totalChildren: node.childCount ?? 0,
        }),
        loading: true,
        error: undefined,
      },
    }));
    try {
      const response = await inspectSaveNode(
        id,
        { path: node.path, offset, limit: PAGE_SIZE },
        c.signal,
      );
      if (!active(g)) return;
      setLoaded((cur) => ({
        ...cur,
        [key]: {
          children: offset
            ? [...(cur[key]?.children ?? []), ...response.children]
            : response.children,
          hasMore: response.hasMore,
          totalChildren: response.totalChildren,
          loading: false,
        },
      }));
    } catch (error) {
      if (
        active(g) &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        setLoaded((cur) => ({
          ...cur,
          [key]: {
            ...(cur[key] ?? {
              children: [],
              hasMore: false,
              totalChildren: node.childCount ?? 0,
            }),
            loading: false,
            error: String(error),
          },
        }));
    } finally {
      finish(c);
    }
  }
  function toggleNode(id: string, node: SaveNodeSummary) {
    const key = pathKey(node.path);
    if (expanded.has(key))
      setExpanded((cur) => {
        const n = new Set(cur);
        n.delete(key);
        return n;
      });
    else {
      setExpanded((cur) => new Set(cur).add(key));
      if (!loaded[key] || loaded[key].error) void loadNode(id, node, 0);
    }
  }
  function loadMore(id: string, node: SaveNodeSummary) {
    const state = loaded[pathKey(node.path)];
    if (state && !state.loading) void loadNode(id, node, state.children.length);
  }

  async function saveScalar(node: SaveNodeSummary, value: EditableScalarValue) {
    if (!session) throw new Error("The save session is no longer active.");
    const g = generation.current,
      id = session.id,
      revision = session.revision,
      c = controller();
    try {
      const response = await updateSaveScalar(
        id,
        { path: node.path, expectedRevision: revision, value },
        c.signal,
      );
      if (!active(g)) return;
      setSession((cur) =>
        cur?.id === id
          ? { ...cur, dirty: response.dirty, revision: response.revision }
          : cur,
      );
      setRoot((cur) =>
        cur
          ? {
              ...cur,
              children: cur.children.map((n) =>
                updateSummary(n, response.path, response.value),
              ),
            }
          : cur,
      );
      setLoaded((cur) =>
        Object.fromEntries(
          Object.entries(cur).map(([key, state]) => [
            key,
            {
              ...state,
              children: state.children.map((n) =>
                updateSummary(n, response.path, response.value),
              ),
            },
          ]),
        ),
      );
      setStatus(`✅ Saved scalar — revision ${response.revision}`);
    } catch (error) {
      if (
        active(g) &&
        error instanceof PalSaveApiError &&
        error.status === 409
      ) {
        const refreshed = await getSaveSession(id, c.signal);
        if (active(g)) {
          setSession(refreshed);
          throw new Error(
            "This view was stale. Session metadata was refreshed; retry the edit.",
          );
        }
      }
      throw error;
    } finally {
      finish(c);
    }
  }

  async function onDownload() {
    if (!session || isExporting) return;
    const g = generation.current,
      current = session,
      c = controller();
    setIsExporting(true);
    setStatus(`Exporting ${current.fileName}…`);
    try {
      const blob = await exportSaveSession(current.id, true, c.signal);
      if (!active(g)) return;
      const name = roundtripFileName(current.fileName),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`✅ Exported ${name} — ${formatFileSize(blob.size)}`);
    } catch (error) {
      if (
        active(g) &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        setStatus(`❌ export: ${String(error)}`);
    } finally {
      finish(c);
      if (active(g)) setIsExporting(false);
    }
  }
  async function loadMoreRoot() {
    if (!session || !root || isLoadingRoot) return;
    const g = generation.current,
      id = session.id,
      offset = root.children.length,
      c = controller();
    setIsLoadingRoot(true);
    setRootError(null);
    try {
      const response = await inspectSaveNode(
        id,
        { path: [], offset, limit: PAGE_SIZE },
        c.signal,
      );
      if (active(g))
        setRoot((cur) =>
          cur
            ? { ...response, children: [...cur.children, ...response.children] }
            : cur,
        );
    } catch (error) {
      if (active(g)) setRootError(String(error));
    } finally {
      finish(c);
      if (active(g)) setIsLoadingRoot(false);
    }
  }

  const ratio =
    session && session.originalSize
      ? session.decompressedSize / session.originalSize
      : 0;
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">PalSave Editor</h1>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".sav" onChange={onFile} />
        <button
          onClick={() => void onDownload()}
          disabled={!session || isExporting}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {isExporting
            ? "Exporting…"
            : session?.dirty
              ? "Validate & download .sav"
              : "Round-trip & download .sav"}
        </button>
      </div>
      <p className="text-sm text-neutral-400">{status}</p>
      {session && (
        <div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-sm">
          <p>
            <span className="text-neutral-500">Session:</span>{" "}
            <code>{session.id}</code>
          </p>
          <p>
            <span className="text-neutral-500">File:</span> {session.fileName}
          </p>
          <p>
            <span className="text-neutral-500">Status:</span>{" "}
            {session.dirty ? "Modified" : "Unmodified"}
          </p>
          {session.dirty && (
            <p>
              <span className="text-neutral-500">Revision:</span>{" "}
              {session.revision}
            </p>
          )}
          <p>
            <span className="text-neutral-500">Compressed size:</span>{" "}
            {formatFileSize(session.originalSize)}
          </p>
          <p>
            <span className="text-neutral-500">Expanded size:</span>{" "}
            {formatFileSize(session.decompressedSize)}
          </p>
          <p>
            <span className="text-neutral-500">Expansion ratio:</span>{" "}
            {ratio.toFixed(2)}×
          </p>
          <div className="mt-3 border-t border-neutral-800 pt-3">
            <h2 className="font-medium">Root properties</h2>
            {isLoadingRoot && (
              <p className="text-neutral-400">Loading root summary…</p>
            )}
            {rootError && <p className="text-red-400">❌ {rootError}</p>}
            {root && (
              <>
                <p className="text-neutral-500">
                  {root.childCount.toLocaleString()} immediate{" "}
                  {root.childCount === 1 ? "property" : "properties"}
                </p>
                <ul className="mt-2">
                  {root.children.map((child) => (
                    <TreeNode
                      key={pathKey(child.path)}
                      node={child}
                      depth={0}
                      sessionId={session.id}
                      expanded={expanded}
                      loaded={loaded}
                      onToggle={toggleNode}
                      onLoadMore={loadMore}
                      onSave={saveScalar}
                    />
                  ))}
                </ul>
                {root.hasMore && (
                  <button
                    disabled={isLoadingRoot}
                    onClick={() => void loadMoreRoot()}
                    className="mt-2 rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-40"
                  >
                    {isLoadingRoot
                      ? "Loading…"
                      : `Load more (${root.children.length}/${root.totalChildren})`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}