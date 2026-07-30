"use client";

import { useState } from "react";
import {
  type EditableScalarValue,
  type SaveNodeResponse,
  type SaveNodeSummary,
} from "@/lib/palsave-api";
import { formatFileSize } from "@/lib/format";
import { isTextScalar, scalarFromInput } from "@/lib/scalar-input";
import { pathKey } from "@/lib/save-tree-state";

export interface LoadedNode {
  children: SaveNodeSummary[];
  hasMore: boolean;
  totalChildren: number;
  loading: boolean;
  error?: string;
}

const KIND_STYLES: Record<string, string> = {
  object: "text-accent",
  array: "text-violet",
  scalar: "text-success",
  raw: "text-warning",
};

function previewText(node: SaveNodeSummary): string | null {
  const preview = node.value?.value ?? node.preview;
  if (preview === undefined) return null;
  return typeof preview === "string"
    ? JSON.stringify(preview)
    : String(preview);
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
  const key = pathKey(node.path);
  const state = loaded[key];
  const isExpanded = expanded.has(key);
  const expandable = (node.childCount ?? 0) > 0;

  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

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

  const preview = previewText(node);

  return (
    <li>
      <div
        className="group flex min-w-0 flex-wrap items-center gap-1.5 rounded py-1 pr-2 hover:bg-raised/70"
        style={{ paddingLeft: `${depth * 1.1 + 0.25}rem` }}
      >
        {expandable ? (
          <button
            type="button"
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.displayName}`}
            aria-expanded={isExpanded}
            onClick={() => onToggle(sessionId, node)}
            className="w-4 shrink-0 text-subtle transition-colors hover:text-accent"
          >
            {isExpanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <code className="break-all text-xs">{node.displayName}</code>

        <span
          className={`shrink-0 text-[0.7rem] uppercase tracking-wide ${
            KIND_STYLES[node.kind] ?? "text-subtle"
          }`}
        >
          {node.kind}
        </span>

        {node.childCount !== undefined && (
          <span className="shrink-0 text-xs text-subtle">
            {node.childCount.toLocaleString()}
          </span>
        )}

        {editing && node.value ? (
          <>
            {node.value.type === "bool" ? (
              <input
                aria-label={`Value for ${node.displayName}`}
                type="checkbox"
                checked={checked}
                onChange={(event) => setChecked(event.target.checked)}
                className="accent-[var(--accent)]"
              />
            ) : (
              <input
                aria-label={`Value for ${node.displayName}`}
                className="field field-sm min-w-36 max-w-64 font-mono"
                type={isTextScalar(node.value) ? "text" : "number"}
                value={input}
                autoFocus
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void save();
                  if (event.key === "Escape") setEditing(false);
                }}
              />
            )}
            <button
              type="button"
              disabled={submitting}
              onClick={() => void save()}
              className="btn btn-primary btn-sm"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setEditing(false);
                setError(undefined);
              }}
              className="btn btn-ghost btn-sm"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {preview !== null && (
              <span className="min-w-0 truncate font-mono text-xs text-accent">
                = {preview}
              </span>
            )}
            {node.editable && (
              <button
                type="button"
                onClick={beginEdit}
                className="btn btn-ghost btn-sm opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              >
                Edit
              </button>
            )}
          </>
        )}

        {node.byteLength !== undefined && (
          <span className="shrink-0 text-xs text-warning">
            {formatFileSize(node.byteLength)}
          </span>
        )}

        {error && (
          <span className="basis-full pl-6 text-xs text-danger" role="alert">
            {error}
          </span>
        )}
      </div>

      {isExpanded && (
        <>
          {state?.loading && (
            <p className="py-1 pl-8 text-xs text-subtle">Loading…</p>
          )}
          {state?.error && (
            <p className="py-1 pl-8 text-xs text-danger" role="alert">
              {state.error}{" "}
              <button
                type="button"
                className="underline"
                onClick={() => onLoadMore(sessionId, node)}
              >
                Retry
              </button>
            </p>
          )}
          {state && !state.error && (
            <ul className="border-l border-line/60">
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
                <li style={{ paddingLeft: `${(depth + 1) * 1.1 + 0.25}rem` }}>
                  <button
                    type="button"
                    disabled={state.loading}
                    onClick={() => onLoadMore(sessionId, node)}
                    className="btn btn-secondary btn-sm my-1"
                  >
                    {state.loading
                      ? "Loading…"
                      : `Load more (${state.children.length.toLocaleString()} / ${state.totalChildren.toLocaleString()})`}
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

/** Paged, editable view of the whole parsed property tree. */
export function SaveTree({
  sessionId,
  root,
  loading,
  error,
  expanded,
  loaded,
  highlightedPath,
  onToggle,
  onLoadMore,
  onLoadMoreRoot,
  onSave,
}: {
  sessionId: string;
  root: SaveNodeResponse | null;
  loading: boolean;
  error: string | null;
  expanded: Set<string>;
  loaded: Record<string, LoadedNode>;
  highlightedPath?: string;
  onToggle: (id: string, node: SaveNodeSummary) => void;
  onLoadMore: (id: string, node: SaveNodeSummary) => void;
  onLoadMoreRoot: () => void;
  onSave: (node: SaveNodeSummary, value: EditableScalarValue) => Promise<void>;
}) {
  return (
    <section className="card overflow-hidden" aria-label="Raw save tree">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-raised px-4 py-3">
        <div>
          <h2 className="font-medium">Raw property tree</h2>
          <p className="text-xs text-muted">
            {root
              ? `${root.childCount.toLocaleString()} root ${
                  root.childCount === 1 ? "property" : "properties"
                }`
              : "Every property the parser understood, paged on demand"}
          </p>
        </div>
        <span className="badge">
          Editable scalars are marked{" "}
          <span className="text-success">scalar</span>
        </span>
      </header>

      {highlightedPath && (
        <p className="border-b border-line bg-accent-soft px-4 py-2 font-mono text-xs text-accent">
          Selected path: {highlightedPath}
        </p>
      )}

      <div className="scroll-slim max-h-[42rem] overflow-auto p-2">
        {loading && !root && (
          <p className="p-3 text-sm text-muted">Loading root summary…</p>
        )}
        {error && (
          <p className="p-3 text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        {root && (
          <>
            <ul>
              {root.children.map((child) => (
                <TreeNode
                  key={pathKey(child.path)}
                  node={child}
                  depth={0}
                  sessionId={sessionId}
                  expanded={expanded}
                  loaded={loaded}
                  onToggle={onToggle}
                  onLoadMore={onLoadMore}
                  onSave={onSave}
                />
              ))}
            </ul>
            {root.hasMore && (
              <button
                type="button"
                disabled={loading}
                onClick={onLoadMoreRoot}
                className="btn btn-secondary btn-sm m-2"
              >
                {loading
                  ? "Loading…"
                  : `Load more (${root.children.length.toLocaleString()} / ${root.totalChildren.toLocaleString()})`}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
