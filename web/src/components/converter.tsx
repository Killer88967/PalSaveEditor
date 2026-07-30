"use client";

import { useRef, useState } from "react";
import {
  decompileSav,
  recompileGvas,
  type ConversionResult,
} from "@/lib/palsave-api";
import { formatDecimal, formatFileSize } from "@/lib/format";
import {
  ArrowRightIcon,
  DownloadIcon,
  PackIcon,
  UnpackIcon,
  UploadIcon,
} from "@/components/icons";

type Mode = "decompile" | "recompile";

interface Outcome extends ConversionResult {
  sourceName: string;
  sourceSize: number;
}

const MODES = {
  decompile: {
    label: "Decompile",
    icon: UnpackIcon,
    accept: ".sav",
    from: ".sav container",
    to: "raw GVAS",
    hint: "Strips the 12-byte Palworld header and decompresses the payload (zlib or Oodle Kraken).",
    run: decompileSav,
  },
  recompile: {
    label: "Recompile",
    icon: PackIcon,
    accept: ".gvas",
    from: "raw GVAS",
    to: ".sav container",
    hint: "Parses the GVAS to prove it is readable, then writes a single-zlib PlZ container the game accepts.",
    run: recompileGvas,
  },
} as const satisfies Record<Mode, unknown>;

/**
 * Stateless converter.
 *
 * Nothing is kept server-side: each request returns the converted bytes and the
 * blob is held in this tab until you download it or switch files.
 */
export function Converter() {
  const [mode, setMode] = useState<Mode>("decompile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const config = MODES[mode];

  function switchMode(next: Mode) {
    setMode(next);
    setError(undefined);
    setOutcome(null);
  }

  async function run(file: File) {
    setError(undefined);
    setOutcome(null);

    if (!file.name.toLowerCase().endsWith(config.accept)) {
      setError(`${file.name} is not a ${config.accept} file.`);
      return;
    }

    setBusy(true);
    try {
      const result = await config.run(file);
      setOutcome({ ...result, sourceName: file.name, sourceSize: file.size });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!outcome) return;
    const url = URL.createObjectURL(outcome.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = outcome.fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const ratio =
    outcome && outcome.sourceSize
      ? outcome.blob.size / outcome.sourceSize
      : undefined;

  return (
    <div className="space-y-4">
      {/* Mode switch */}
      <div
        className="card flex flex-wrap items-center gap-2 p-2"
        role="tablist"
      >
        {(Object.keys(MODES) as Mode[]).map((key) => {
          const entry = MODES[key];
          const Glyph = entry.icon;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => switchMode(key)}
              className="tab"
            >
              <Glyph className="size-4" />
              {entry.label}
            </button>
          );
        })}
        <p className="ml-auto flex items-center gap-2 px-2 font-mono text-xs text-muted">
          {config.from}
          <ArrowRightIcon className="size-3.5 text-accent" />
          {config.to}
        </p>
      </div>

      <p className="text-sm text-muted">{config.hint}</p>

      {/* Drop target */}
      <div
        className="dropzone"
        data-dragging={dragging}
        role="button"
        tabIndex={0}
        aria-label={`Choose a ${config.accept} file to ${config.label.toLowerCase()}`}
        onClick={() => input.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void run(file);
        }}
      >
        <span className="rounded-xl bg-accent-soft p-3 text-accent">
          <UploadIcon className="size-6" />
        </span>
        <p className="font-medium">
          {busy
            ? "Converting…"
            : `Drop a ${config.accept} file, or click to browse`}
        </p>
        <p className="text-sm text-muted">
          One file at a time. It is converted in the Rust API and returned
          immediately — no session is created.
        </p>

        <input
          ref={input}
          type="file"
          accept={config.accept}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void run(file);
            event.target.value = "";
          }}
        />
      </div>

      {error && (
        <div className="alert alert-danger text-sm" role="alert">
          <p>{error}</p>
        </div>
      )}

      {outcome && (
        <div className="card overflow-hidden">
          <header className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-4 py-3">
            <h2 className="font-medium">Conversion complete</h2>
            {outcome.compression && (
              <span className="badge badge-accent">{outcome.compression}</span>
            )}
            <button
              type="button"
              onClick={save}
              className="btn btn-primary btn-sm ml-auto"
            >
              <DownloadIcon className="size-4" />
              Download {outcome.fileName}
            </button>
          </header>

          <dl className="grid gap-px bg-line sm:grid-cols-3">
            {[
              {
                label: "Input",
                value: formatFileSize(outcome.sourceSize),
                hint: outcome.sourceName,
              },
              {
                label: "Output",
                value: formatFileSize(outcome.blob.size),
                hint: outcome.fileName,
              },
              {
                label: mode === "decompile" ? "Expansion" : "Compression",
                value: ratio ? `${formatDecimal(ratio, 2)}×` : "—",
                hint:
                  outcome.decompressedSize !== undefined
                    ? `${formatFileSize(outcome.decompressedSize)} of GVAS`
                    : undefined,
              },
            ].map((cell) => (
              <div key={cell.label} className="bg-surface px-4 py-3">
                <dt className="text-xs text-subtle">{cell.label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                  {cell.value}
                </dd>
                {cell.hint && (
                  <p
                    className="truncate font-mono text-xs text-muted"
                    title={cell.hint}
                  >
                    {cell.hint}
                  </p>
                )}
              </div>
            ))}
          </dl>

          {mode === "recompile" && (
            <p className="border-t border-line px-4 py-3 text-xs text-muted">
              The output is a <code>PlZ</code> single-zlib container rather than
              the <code>PlM</code> Oodle form the game writes. Palworld reads it
              and re-saves in its own format the next time it writes the world.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
