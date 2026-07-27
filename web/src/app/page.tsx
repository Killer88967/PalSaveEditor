"use client";

import { useState } from "react";
import init, { sav_to_json, json_to_sav } from "@/wasm/palsave_core";

let wasmReady: Promise<unknown> | null = null;
function ensureWasm() {
  if (!wasmReady) wasmReady = init({ module_or_path: "/palsave_core_bg.wasm" });
  return wasmReady;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function setAtPath(root: Json, path: (string | number)[], value: Json): Json {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const copy = root.slice();
    copy[head as number] = setAtPath(copy[head as number], rest, value);
    return copy;
  }
  const obj = (root ?? {}) as { [k: string]: Json };
  return { ...obj, [head]: setAtPath(obj[head as string], rest, value) };
}

function subtreeMatches(value: Json, q: string): boolean {
  if (value === null || typeof value !== "object") return false;
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value);
  return entries.some(
    ([k, v]) => k.toLowerCase().includes(q) || subtreeMatches(v, q),
  );
}

function LeafInput({
  value,
  onChange,
}: {
  value: Json;
  onChange: (v: Json) => void;
}) {
  if (typeof value === "boolean")
    return (
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  if (typeof value === "number")
    return (
      <input
        type="number"
        defaultValue={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
        className="w-40 rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-100"
      />
    );
  if (value === null) return <span className="text-neutral-600">null</span>;
  return (
    <input
      type="text"
      defaultValue={String(value)}
      onChange={(e) => onChange(e.target.value)}
      className="w-64 rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-100"
    />
  );
}

function Node({
  k,
  value,
  path,
  q,
  onChange,
}: {
  k: string;
  value: Json;
  path: (string | number)[];
  q: string;
  onChange: (path: (string | number)[], v: Json) => void;
}) {
  const isBranch = value !== null && typeof value === "object";
  const keyMatch = q !== "" && k.toLowerCase().includes(q);
  const [open, setOpen] = useState(false);

  if (!(q === "" || keyMatch || (isBranch && subtreeMatches(value, q))))
    return null;
  const expanded = q !== "" ? true : open;

  if (!isBranch) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <span className={keyMatch ? "text-amber-400" : "text-neutral-400"}>
          {k}:
        </span>
        <LeafInput value={value} onChange={(v) => onChange(path, v)} />
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as { [key: string]: Json });

  return (
    <div className="ml-3 border-l border-neutral-800 pl-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`py-0.5 text-left ${keyMatch ? "text-amber-400" : "text-neutral-300"}`}
      >
        {expanded ? "▾" : "▸"} {k}{" "}
        <span className="text-neutral-600">
          {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </button>
      {expanded &&
        entries.map(([ck, cv]) => (
          <Node
            key={ck}
            k={ck}
            value={cv}
            path={[...path, Array.isArray(value) ? Number(ck) : ck]}
            q={q}
            onChange={onChange}
          />
        ))}
    </div>
  );
}

export default function Home() {
  const [status, setStatus] = useState("Pick a .sav file to parse.");
  const [data, setData] = useState<Json | null>(null);
  const [fileName, setFileName] = useState("");
  const [q, setQ] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus(`Reading ${file.name}…`);
    setData(null);
    setFileName(file.name);
    try {
      await ensureWasm();
      const bytes = new Uint8Array(await file.arrayBuffer());
      setData(JSON.parse(sav_to_json(bytes)));
      setStatus(`✅ Parsed ${file.name}`);
    } catch (err) {
      setStatus(`❌ ${String(err)}`);
    }
  }

  function onChange(path: (string | number)[], v: Json) {
    setData((d) => (d === null ? d : setAtPath(d, path, v)));
  }

  async function onDownload() {
    if (data === null) return;
    try {
      await ensureWasm();
      const bytes = json_to_sav(JSON.stringify(data));
      const blob = new Blob([new Uint8Array(bytes)], {
        type: "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || "edited.sav";
      a.click();
      URL.revokeObjectURL(url);
      setStatus(
        `✅ Repacked ${a.download} — ${bytes.length.toLocaleString()} bytes`,
      );
    } catch (err) {
      setStatus(`❌ repack: ${String(err)}`);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">PalSave Editor</h1>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".sav" onChange={onFile} />
        <button
          onClick={onDownload}
          disabled={data === null}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Repack &amp; download .sav
        </button>
        {data !== null && (
          <input
            placeholder="filter keys… (try: Tech)"
            value={q}
            onChange={(e) => setQ(e.target.value.toLowerCase())}
            className="rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
          />
        )}
      </div>
      <p className="text-sm text-neutral-400">{status}</p>
      {data !== null && (
        <div className="max-h-[70vh] overflow-auto rounded bg-neutral-950 p-3 font-mono text-xs">
          <Node k="save" value={data} path={[]} q={q} onChange={onChange} />
        </div>
      )}
    </main>
  );
}