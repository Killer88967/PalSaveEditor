"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { InventoryEditor } from "@/components/inventory-editor";
import { PalList } from "@/components/pal-list";
import { PlayerEditor } from "@/components/player-editor";
import { SaveDropzone, UploadSummary } from "@/components/save-dropzone";
import { SaveOverviewPanel } from "@/components/save-overview";
import { SaveTree, type LoadedNode } from "@/components/save-tree";
import {
  AlertIcon,
  BagIcon,
  ChartIcon,
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  PalIcon,
  PlayerIcon,
  TreeIcon,
  UnpackIcon,
} from "@/components/icons";
import {
  createSaveSession,
  deleteSaveSession,
  exportSaveSession,
  exportSaveSessionGvas,
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
import {
  formatFileSize,
  roundtripFileName,
  stripExtension,
} from "@/lib/format";
import { pathKey, updateSummaryAtPath } from "@/lib/save-tree-state";

const PAGE_SIZE = 100;

type View = "overview" | "pals" | "players" | "inventory" | "raw";

const VIEWS = [
  { id: "overview", label: "Overview", icon: ChartIcon },
  { id: "pals", label: "Pals", icon: PalIcon },
  { id: "players", label: "Players", icon: PlayerIcon },
  { id: "inventory", label: "Inventories", icon: BagIcon },
  { id: "raw", label: "Raw tree", icon: TreeIcon },
] as const satisfies readonly { id: View; label: string; icon: unknown }[];

type StatusTone = "info" | "success" | "error";

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function EditorPage() {
  const [status, setStatus] = useState<{ tone: StatusTone; text: string }>({
    tone: "info",
    text: "Choose the .sav files from one Palworld world to begin.",
  });
  const [session, setSession] = useState<SaveSession | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [opening, setOpening] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [palRefresh, setPalRefresh] = useState(0);
  const [focusPlayer, setFocusPlayer] = useState<string>();

  const [root, setRoot] = useState<SaveNodeResponse | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [isLoadingRoot, setIsLoadingRoot] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<Record<string, LoadedNode>>({});
  const [rawPath, setRawPath] = useState<string>();

  const [exporting, setExporting] = useState<"sav" | "gvas" | null>(null);

  // Every request is tagged with a generation so responses that arrive after
  // the user has loaded a different save are discarded rather than applied.
  const generation = useRef(0);
  const controllers = useRef<Set<AbortController>>(new Set());
  const active = (value: number) => generation.current === value;

  function controller() {
    const created = new AbortController();
    controllers.current.add(created);
    return created;
  }

  function finish(created: AbortController) {
    controllers.current.delete(created);
  }

  function resetState() {
    generation.current += 1;
    controllers.current.forEach((entry) => entry.abort());
    controllers.current.clear();
    setRoot(null);
    setRootError(null);
    setIsLoadingRoot(false);
    setExporting(null);
    setExpanded(new Set());
    setLoaded({});
    setRawPath(undefined);
    setFocusPlayer(undefined);
    setView("overview");
    setPalRefresh(0);
  }

  async function openFiles(picked: File[]) {
    const previous = session;
    resetState();
    const current = generation.current;
    setSession(null);
    setFiles(picked);
    setOpening(true);
    setStatus({
      tone: "info",
      text: `Parsing ${picked.length} file${picked.length === 1 ? "" : "s"}…`,
    });

    if (previous) {
      void deleteSaveSession(previous.id).catch((error) =>
        console.warn("Failed to delete the previous save session:", error),
      );
    }

    const abort = controller();
    try {
      const created = await createSaveSession(picked, abort.signal);
      if (!active(current)) {
        void deleteSaveSession(created.id);
        return;
      }

      setSession(created);
      setStatus({
        tone: "success",
        text: `Opened ${created.fileName} — ${created.container.compression} container, ${formatFileSize(created.decompressedSize)} of GVAS`,
      });

      setIsLoadingRoot(true);
      try {
        const response = await getSaveRoot(created.id, abort.signal);
        if (active(current)) setRoot(response);
      } catch (error) {
        if (active(current) && !isAbort(error)) setRootError(String(error));
      } finally {
        if (active(current)) setIsLoadingRoot(false);
      }
    } catch (error) {
      if (active(current) && !isAbort(error)) {
        setStatus({ tone: "error", text: String(error) });
        setFiles([]);
      }
    } finally {
      finish(abort);
      if (active(current)) setOpening(false);
    }
  }

  function closeSession() {
    const previous = session;
    resetState();
    setSession(null);
    setFiles([]);
    setStatus({
      tone: "info",
      text: "Session closed. Choose the .sav files from one Palworld world to begin.",
    });
    if (previous) {
      void deleteSaveSession(previous.id).catch((error) =>
        console.warn("Failed to delete the save session:", error),
      );
    }
  }

  async function loadNode(id: string, node: SaveNodeSummary, offset: number) {
    const current = generation.current;
    const key = pathKey(node.path);
    const abort = controller();

    setLoaded((state) => ({
      ...state,
      [key]: {
        ...(state[key] ?? {
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
        abort.signal,
      );
      if (!active(current)) return;
      setLoaded((state) => ({
        ...state,
        [key]: {
          children: offset
            ? [...(state[key]?.children ?? []), ...response.children]
            : response.children,
          hasMore: response.hasMore,
          totalChildren: response.totalChildren,
          loading: false,
        },
      }));
    } catch (error) {
      if (!active(current) || isAbort(error)) return;
      setLoaded((state) => ({
        ...state,
        [key]: {
          ...(state[key] ?? {
            children: [],
            hasMore: false,
            totalChildren: node.childCount ?? 0,
          }),
          loading: false,
          error: String(error),
        },
      }));
    } finally {
      finish(abort);
    }
  }

  function toggleNode(id: string, node: SaveNodeSummary) {
    const key = pathKey(node.path);
    if (expanded.has(key)) {
      setExpanded((state) => {
        const next = new Set(state);
        next.delete(key);
        return next;
      });
      return;
    }

    setExpanded((state) => new Set(state).add(key));
    if (!loaded[key] || loaded[key].error) void loadNode(id, node, 0);
  }

  function loadMore(id: string, node: SaveNodeSummary) {
    const state = loaded[pathKey(node.path)];
    if (state && !state.loading) void loadNode(id, node, state.children.length);
  }

  async function loadMoreRoot() {
    if (!session || !root || isLoadingRoot) return;
    const current = generation.current;
    const abort = controller();
    setIsLoadingRoot(true);
    setRootError(null);

    try {
      const response = await inspectSaveNode(
        session.id,
        { path: [], offset: root.children.length, limit: PAGE_SIZE },
        abort.signal,
      );
      if (active(current)) {
        setRoot((state) =>
          state
            ? {
                ...response,
                children: [...state.children, ...response.children],
              }
            : state,
        );
      }
    } catch (error) {
      if (active(current) && !isAbort(error)) setRootError(String(error));
    } finally {
      finish(abort);
      if (active(current)) setIsLoadingRoot(false);
    }
  }

  async function saveScalar(node: SaveNodeSummary, value: EditableScalarValue) {
    if (!session) throw new Error("The save session is no longer active.");
    const current = generation.current;
    const { id, revision } = session;
    const abort = controller();

    try {
      const response = await updateSaveScalar(
        id,
        { path: node.path, expectedRevision: revision, value },
        abort.signal,
      );
      if (!active(current)) return;

      setSession((state) =>
        state?.id === id
          ? { ...state, dirty: response.dirty, revision: response.revision }
          : state,
      );
      setRoot((state) =>
        state
          ? {
              ...state,
              children: state.children.map((child) =>
                updateSummaryAtPath(child, response.path, response.value),
              ),
            }
          : state,
      );
      setLoaded((state) =>
        Object.fromEntries(
          Object.entries(state).map(([key, node]) => [
            key,
            {
              ...node,
              children: node.children.map((child) =>
                updateSummaryAtPath(child, response.path, response.value),
              ),
            },
          ]),
        ),
      );
      setPalRefresh((value) => value + 1);
      setStatus({
        tone: "success",
        text: `Scalar written — revision ${response.revision}`,
      });
    } catch (error) {
      if (
        active(current) &&
        error instanceof PalSaveApiError &&
        error.status === 409
      ) {
        const refreshed = await getSaveSession(id, abort.signal);
        if (active(current)) {
          setSession(refreshed);
          throw new Error(
            "This view was stale. Session metadata was refreshed — retry the edit.",
          );
        }
      }
      throw error;
    } finally {
      finish(abort);
    }
  }

  async function download(kind: "sav" | "gvas") {
    if (!session || exporting) return;
    const current = generation.current;
    const abort = controller();
    setExporting(kind);
    setStatus({ tone: "info", text: `Exporting ${session.fileName}…` });

    try {
      const blob =
        kind === "sav"
          ? await exportSaveSession(session.id, true, abort.signal)
          : await exportSaveSessionGvas(session.id, abort.signal);
      if (!active(current)) return;

      const name =
        kind === "sav"
          ? roundtripFileName(session.fileName)
          : `${stripExtension(session.fileName, ".sav")}.gvas`;

      triggerDownload(blob, name);
      setStatus({
        tone: "success",
        text: `Exported ${name} — ${formatFileSize(blob.size)}`,
      });
    } catch (error) {
      if (active(current) && !isAbort(error)) {
        setStatus({ tone: "error", text: `Export failed: ${String(error)}` });
      }
    } finally {
      finish(abort);
      if (active(current)) setExporting(null);
    }
  }

  function viewRawPath(path: SavePathSegment[]) {
    setView("raw");
    setRawPath(JSON.stringify(path));
  }

  const statusStyles: Record<StatusTone, string> = {
    info: "text-muted",
    success: "text-success",
    error: "text-danger",
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Save editor</h1>
        <p className="max-w-2xl text-muted">
          Upload a world, inspect what is inside it, edit the parts you meant to
          change, then export a validated container.
        </p>
      </header>

      {!session ? (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-3">
            <SaveDropzone
              onFilesAction={(picked) => void openFiles(picked)}
              busy={opening}
              disabled={opening}
            />
            <p className={`text-sm ${statusStyles[status.tone]}`} role="status">
              {status.text}
            </p>
            <UploadSummary files={files} />
          </div>

          <aside className="space-y-4">
            <div className="alert alert-warning">
              <AlertIcon className="mt-0.5 size-5 shrink-0 text-warning" />
              <p>
                <strong className="font-semibold">Back up first.</strong> Copy
                your whole world folder before editing.{" "}
                <Link href="/guide" className="text-accent underline">
                  Find your save folder
                </Link>
              </p>
            </div>

            <div className="card p-5 text-sm">
              <h2 className="font-medium">What to upload</h2>
              <ul className="mt-3 space-y-2 text-muted">
                <li className="flex gap-2">
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>
                    <code className="text-accent">Level.sav</code> — required.
                    Holds the world, every character and every container.
                  </span>
                </li>
                <li className="flex gap-2">
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>
                    Everything in <code>Players/</code> — optional, but
                    inventory editing needs them.
                  </span>
                </li>
              </ul>
              <p className="mt-4 text-xs text-subtle">
                Files are parsed into the API process&apos;s memory. Nothing is
                written to disk and the session disappears when the API
                restarts.
              </p>
            </div>

            <Link href="/tools" className="btn btn-secondary w-full">
              <UnpackIcon className="size-4" />
              Only need raw GVAS? Use the converter
            </Link>
          </aside>
        </div>
      ) : (
        <>
          {/* Session bar */}
          <section className="card overflow-hidden" aria-label="Session">
            <div className="flex flex-wrap items-center gap-3 border-b border-line bg-raised px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  <span className="truncate font-mono text-sm">
                    {session.fileName}
                  </span>
                  {session.dirty ? (
                    <span className="badge badge-warning">
                      Modified · rev {session.revision}
                    </span>
                  ) : (
                    <span className="badge badge-success">Unmodified</span>
                  )}
                </p>
                <p className="text-xs text-muted">
                  {session.container.magic} · {session.container.compression} ·{" "}
                  {formatFileSize(session.originalSize)} →{" "}
                  {formatFileSize(session.decompressedSize)} ·{" "}
                  {session.playerFileCount} player file
                  {session.playerFileCount === 1 ? "" : "s"}
                </p>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void download("gvas")}
                  disabled={exporting !== null}
                  className="btn btn-secondary btn-sm"
                  title="Download the uncompressed Unreal GVAS payload"
                >
                  <UnpackIcon className="size-4" />
                  {exporting === "gvas" ? "Exporting…" : "GVAS"}
                </button>
                <button
                  type="button"
                  onClick={() => void download("sav")}
                  disabled={exporting !== null}
                  className="btn btn-primary btn-sm"
                >
                  <DownloadIcon className="size-4" />
                  {exporting === "sav"
                    ? "Exporting…"
                    : session.dirty
                      ? "Validate & download .sav"
                      : "Round-trip .sav"}
                </button>
                <button
                  type="button"
                  onClick={closeSession}
                  className="btn btn-ghost btn-sm"
                  aria-label="Close this save session"
                >
                  <CloseIcon className="size-4" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div
                className="scroll-slim flex gap-1 overflow-x-auto"
                role="tablist"
              >
                {VIEWS.map(({ id, label, icon: Glyph }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={view === id}
                    onClick={() => setView(id)}
                    className="tab"
                  >
                    <Glyph className="size-4" />
                    {label}
                  </button>
                ))}
              </div>
              <p
                className={`ml-auto min-w-0 truncate text-xs ${statusStyles[status.tone]}`}
                role="status"
              >
                {status.text}
              </p>
            </div>
          </section>

          {view === "overview" && (
            <SaveOverviewPanel
              session={session}
              revision={session.revision}
              onSelectPlayerAction={(playerUid) => {
                setFocusPlayer(playerUid);
                setView("inventory");
              }}
            />
          )}

          {view === "pals" && (
            <PalList
              key={session.id}
              sessionId={session.id}
              generation={generation.current}
              refreshToken={palRefresh}
              revision={session.revision}
              onSessionUpdateAction={(dirty, revision) => {
                setSession((state) =>
                  state ? { ...state, dirty, revision } : state,
                );
                setStatus({
                  tone: "success",
                  text: `Pal saved — revision ${revision}`,
                });
              }}
              onViewRawAction={viewRawPath}
            />
          )}

          {view === "players" && (
            <PlayerEditor
              key={session.id}
              sessionId={session.id}
              revision={session.revision}
              focusPlayerUid={focusPlayer}
              onSessionUpdateAction={(dirty, revision) => {
                setSession((state) =>
                  state ? { ...state, dirty, revision } : state,
                );
                setStatus({
                  tone: "success",
                  text: `Player saved — revision ${revision}`,
                });
              }}
            />
          )}

          {view === "inventory" && (
            <InventoryEditor
              sessionId={session.id}
              revision={session.revision}
              focusPlayerUid={focusPlayer}
              onSessionUpdateAction={(dirty, revision) => {
                setSession((state) =>
                  state ? { ...state, dirty, revision } : state,
                );
                setStatus({
                  tone: "success",
                  text: `Inventory slot saved — revision ${revision}`,
                });
              }}
            />
          )}

          {view === "raw" && (
            <SaveTree
              sessionId={session.id}
              root={root}
              loading={isLoadingRoot}
              error={rootError}
              expanded={expanded}
              loaded={loaded}
              highlightedPath={rawPath}
              onToggleAction={toggleNode}
              onLoadMoreAction={loadMore}
              onLoadMoreRootAction={() => void loadMoreRoot()}
              onSaveAction={saveScalar}
            />
          )}
        </>
      )}
    </div>
  );
}
