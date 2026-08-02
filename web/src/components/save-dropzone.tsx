"use client";

import { useRef, useState } from "react";
import { UploadIcon } from "@/components/icons";
import { formatFileSize } from "@/lib/format";

/**
 * File picker that also accepts drops.
 *
 * Palworld worlds are a folder of `.sav` files, so this takes several at once:
 * `Level.sav` is required and any `Players/*.sav` files unlock inventory
 * editing. Filtering happens here so an accidental screenshot drop is a clear
 * message rather than a server error.
 */
export function SaveDropzone({
  onFilesAction,
  busy,
  disabled,
}: {
  onFilesAction: (files: File[]) => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string>();

  function accept(list: FileList | null) {
    setRejected(undefined);
    const files = Array.from(list ?? []);
    if (!files.length) return;

    const saves = files.filter((file) =>
      file.name.toLowerCase().endsWith(".sav"),
    );

    if (!saves.length) {
      setRejected(
        `None of those are .sav files (${files.map((file) => file.name).join(", ")}).`,
      );
      return;
    }

    const hasLevel = saves.some(
      (file) => file.name.toLowerCase().replace(/^.*[\\/]/, "") === "level.sav",
    );
    if (!hasLevel) {
      setRejected("Include Level.sav — it holds the world the editor reads.");
      return;
    }

    if (saves.length < files.length) {
      setRejected(
        `Ignored ${files.length - saves.length} file(s) that are not .sav.`,
      );
    }

    onFilesAction(saves);
  }

  return (
    <div className="space-y-2">
      <div
        className="dropzone"
        data-dragging={dragging}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label="Choose or drop Palworld .sav files"
        onClick={() => !disabled && input.current?.click()}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) accept(event.dataTransfer.files);
        }}
      >
        <span className="rounded-xl bg-accent-soft p-3 text-accent">
          <UploadIcon className="size-6" />
        </span>
        <p className="font-medium">
          {busy ? "Parsing save files…" : "Drop your save files here"}
        </p>
        <p className="max-w-md text-sm text-muted">
          <code className="text-accent">Level.sav</code> is required. Add the
          files from <code>Players/</code> in the same drop to edit inventories.
        </p>
        <span className="btn btn-secondary btn-sm mt-1">Browse files</span>

        <input
          ref={input}
          type="file"
          accept=".sav"
          multiple
          disabled={disabled}
          className="hidden"
          onChange={(event) => {
            accept(event.target.files);
            // Allow re-selecting the same path after a failed parse.
            event.target.value = "";
          }}
        />
      </div>

      {rejected && (
        <p className="text-sm text-warning" role="alert">
          {rejected}
        </p>
      )}
    </div>
  );
}

/** Compact summary of the files that produced the current session. */
export function UploadSummary({ files }: { files: File[] }) {
  if (!files.length) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {files.map((file) => (
        <li key={file.name} className="badge">
          <span className="max-w-52 truncate font-mono">{file.name}</span>
          <span className="text-subtle">{formatFileSize(file.size)}</span>
        </li>
      ))}
    </ul>
  );
}
