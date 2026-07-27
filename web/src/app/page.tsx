"use client";

import { useState } from "react";
import {
  createSaveSession,
  deleteSaveSession,
  exportSaveSession,
  getSaveRoot,
  inspectSaveNode,
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

function pathKey(path: SavePathSegment[]): string {
  return JSON.stringify(path);
}

function previewText(value: SaveNodeSummary["preview"]): string | null {
  if (value === undefined) return null;
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function TreeNode({
  node,
  depth,
  sessionId,
  expanded,
  loaded,
  onToggle,
  onLoadMore,
}: {
  node: SaveNodeSummary;
  depth: number;
  sessionId: string;
  expanded: Set<string>;
  loaded: Record<string, LoadedNode>;
  onToggle: (sessionId: string, node: SaveNodeSummary) => void;
  onLoadMore: (sessionId: string, node: SaveNodeSummary) => void;
}) {
  const key = pathKey(node.path);
  const state = loaded[key];
  const isExpanded = expanded.has(key);
  const expandable = (node.childCount ?? 0) > 0;
  const preview = previewText(node.preview);

  return (
    <li>
      <div
        className="flex min-w-0 items-start gap-1 py-0.5"
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
        {preview !== null && (
          <span className="min-w-0 truncate text-sky-300">= {preview}</span>
        )}
        {node.byteLength !== undefined && (
          <span className="shrink-0 text-amber-300">
            {formatFileSize(node.byteLength)}
          </span>
        )}
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
                />
              ))}
              {state.hasMore && (
                <li style={{ paddingLeft: (depth + 2) * 16 }}>
                  <button
                    type="button"
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

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 bytes";

  const units = ["bytes", "KB", "MB", "GB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function roundtripFileName(fileName: string): string {
  const baseName = fileName.toLowerCase().endsWith(".sav")
    ? fileName.slice(0, -4)
    : fileName;

  return `${baseName || "Level"}.roundtrip.sav`;
}

export default function Home() {
  const [status, setStatus] = useState("Pick a .sav file to parse.");
  const [session, setSession] = useState<SaveSession | null>(null);
  const [root, setRoot] = useState<SaveNodeResponse | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [isLoadingRoot, setIsLoadingRoot] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<Record<string, LoadedNode>>({});

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setRoot(null);
    setRootError(null);
    setIsLoadingRoot(false);
    setExpanded(new Set());
    setLoaded({});

    if (session) {
      try {
        await deleteSaveSession(session.id);
      } catch (error) {
        console.warn("Failed to delete previous save session:", error);
      }
      setSession(null);
    }

    const file = e.target.files?.[0];
    if (!file) return;
    setStatus(`Reading ${file.name}…`);

    try {
      const createdSession = await createSaveSession(file);
      setSession(createdSession);
      setStatus(`✅ Opened ${createdSession.fileName} in Rust`);
      setIsLoadingRoot(true);

      try {
        setRoot(await getSaveRoot(createdSession.id));
      } catch (rootRequestError) {
        setRootError(String(rootRequestError));
      } finally {
        setIsLoadingRoot(false);
      }
    } catch (err) {
      setStatus(`❌ ${String(err)}`);
    }
  }

  async function onDownload() {
    if (!session || isExporting) return;
    setIsExporting(true);
    setStatus(`Exporting ${session.fileName}…`);

    try {
      const blob = await exportSaveSession(session.id);
      const downloadName = roundtripFileName(session.fileName);
      const url = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloadName;
      anchor.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1_000);
      setStatus(`✅ Exported ${downloadName} — ${formatFileSize(blob.size)}`);
    } catch (err) {
      setStatus(`❌ export: ${String(err)}`);
    } finally {
      setIsExporting(false);
    }
  }

  const expansionRatio =
    session && session.originalSize > 0
      ? session.decompressedSize / session.originalSize
      : 0;

  async function loadNode(
    sessionId: string,
    node: SaveNodeSummary,
    offset: number,
  ) {
    const key = pathKey(node.path);
    setLoaded((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? {
          children: [],
          hasMore: false,
          totalChildren: node.childCount ?? 0,
        }),
        loading: true,
        error: undefined,
      },
    }));
    try {
      const response = await inspectSaveNode(sessionId, {
        path: node.path,
        offset,
        limit: PAGE_SIZE,
      });
      setLoaded((current) => ({
        ...current,
        [key]: {
          children:
            offset === 0
              ? response.children
              : [...(current[key]?.children ?? []), ...response.children],
          hasMore: response.hasMore,
          totalChildren: response.totalChildren,
          loading: false,
        },
      }));
    } catch (error) {
      setLoaded((current) => ({
        ...current,
        [key]: {
          ...(current[key] ?? {
            children: [],
            hasMore: false,
            totalChildren: node.childCount ?? 0,
          }),
          loading: false,
          error: String(error),
        },
      }));
    }
  }

  function toggleNode(sessionId: string, node: SaveNodeSummary) {
    const key = pathKey(node.path);
    if (expanded.has(key)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      return;
    }
    setExpanded((current) => new Set(current).add(key));
    if (!loaded[key] || loaded[key].error) void loadNode(sessionId, node, 0);
  }

  function loadMore(sessionId: string, node: SaveNodeSummary) {
    const state = loaded[pathKey(node.path)];
    if (state && !state.loading)
      void loadNode(sessionId, node, state.children.length);
  }

  async function loadMoreRoot() {
    if (!session || !root || isLoadingRoot) return;
    setIsLoadingRoot(true);
    setRootError(null);
    try {
      const response = await inspectSaveNode(session.id, {
        path: [],
        offset: root.children.length,
        limit: PAGE_SIZE,
      });
      setRoot({
        ...response,
        children: [...root.children, ...response.children],
      });
    } catch (error) {
      setRootError(String(error));
    } finally {
      setIsLoadingRoot(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">PalSave Editor</h1>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".sav" onChange={onFile} />
        <button
          onClick={onDownload}
          disabled={session === null || isExporting}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {isExporting ? "Exporting…" : "Round-trip & download .sav"}
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
            <span className="text-neutral-500">Compressed size:</span>{" "}
            {formatFileSize(session.originalSize)}
          </p>
          <p>
            <span className="text-neutral-500">Expanded size:</span>{" "}
            {formatFileSize(session.decompressedSize)}
          </p>
          <p>
            <span className="text-neutral-500">Expansion ratio:</span>{" "}
            {expansionRatio.toFixed(2)}×
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
                    />
                  ))}
                </ul>
                {root.hasMore && (
                  <button
                    type="button"
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
