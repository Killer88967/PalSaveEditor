"use client";

import { useState } from "react";
import {
  createSaveSession,
  deleteSaveSession,
  exportSaveSession,
  type SaveSession,
} from "@/lib/palsave-api";

function roundtripFileName(fileName: string): string {
  const baseName = fileName.toLowerCase().endsWith(".sav")
    ? fileName.slice(0, -4)
    : fileName;

  return `${baseName || "Level"}.roundtrip.sav`;
}

export default function Home() {
  const [status, setStatus] = useState("Pick a .sav file to parse.");
  const [session, setSession] = useState<SaveSession | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
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
      setStatus(
        `✅ Opened ${createdSession.fileName} in Rust — ${createdSession.originalSize.toLocaleString()} bytes`,
      );
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

      setStatus(
        `✅ Exported ${downloadName} — ${blob.size.toLocaleString()} bytes`,
      );
    } catch (err) {
      setStatus(`❌ export: ${String(err)}`);
    } finally {
      setIsExporting(false);
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
            {session.originalSize.toLocaleString()} bytes
          </p>
        </div>
      )}
    </main>
  );
}
