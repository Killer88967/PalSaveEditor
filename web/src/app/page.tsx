"use client";

import { useState } from "react";
import {
  createSaveSession,
  deleteSaveSession,
  exportSaveSession,
  getSaveRoot,
  type SaveRootNode,
  type SaveSession,
} from "@/lib/palsave-api";

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
  const [root, setRoot] = useState<SaveRootNode | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [isLoadingRoot, setIsLoadingRoot] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setRoot(null);
    setRootError(null);
    setIsLoadingRoot(false);

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

      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = downloadName;
        anchor.click();
      } finally {
        URL.revokeObjectURL(url);
      }
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
          <p><span className="text-neutral-500">Session:</span>{" "}<code>{session.id}</code></p>
          <p><span className="text-neutral-500">File:</span> {session.fileName}</p>
          <p><span className="text-neutral-500">Compressed size:</span>{" "}{formatFileSize(session.originalSize)}</p>
          <p><span className="text-neutral-500">Expanded size:</span>{" "}{formatFileSize(session.decompressedSize)}</p>
          <p><span className="text-neutral-500">Expansion ratio:</span>{" "}{expansionRatio.toFixed(2)}×</p>

          <div className="mt-3 border-t border-neutral-800 pt-3">
            <h2 className="font-medium">Root properties</h2>
            {isLoadingRoot && <p className="text-neutral-400">Loading root summary…</p>}
            {rootError && <p className="text-red-400">❌ {rootError}</p>}
            {root && (
              <>
                <p className="text-neutral-500">
                  {root.childCount.toLocaleString()} immediate {root.childCount === 1 ? "property" : "properties"}
                </p>
                <ul className="mt-2 space-y-1">
                  {root.children.map((child) => (
                    <li key={child.key}>
                      <code>{child.key}</code><span className="text-neutral-500"> — {child.kind}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
