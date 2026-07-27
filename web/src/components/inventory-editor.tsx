"use client";
import { useEffect, useState } from "react";
import {
  getInventoryPlayers,
  getPlayerInventory,
  updateInventorySlot,
  PalSaveApiError,
  type InventoryContainer,
  type InventorySlot,
  type PlayerInventoryOwner,
} from "@/lib/palsave-api";
export function InventoryEditor({
  sessionId,
  revision,
  onSessionUpdate,
}: {
  sessionId: string;
  revision: number;
  onSessionUpdate: (dirty: boolean, revision: number) => void;
}) {
  const [players, setPlayers] = useState<PlayerInventoryOwner[]>([]),
    [selected, setSelected] = useState(""),
    [guild, setGuild] = useState(false),
    [containers, setContainers] = useState<InventoryContainer[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    void getInventoryPlayers(sessionId, c.signal)
      .then((v) => {
        setPlayers(v);
        setSelected(v[0]?.playerUid ?? "");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    return () => c.abort();
  }, [sessionId]);
  useEffect(() => {
    if (!selected) return;
    const c = new AbortController();
    queueMicrotask(() => {
      if (!c.signal.aborted) {
        setLoading(true);
        setError(undefined);
      }
    });
    void getPlayerInventory(sessionId, selected, guild, c.signal)
      .then(setContainers)
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [guild, selected, sessionId]);
  async function save(
    containerId: string,
    slot: InventorySlot,
    itemId: string,
    quantity: number,
  ) {
    try {
      const r = await updateInventorySlot(
        sessionId,
        selected,
        containerId,
        slot.index,
        { expectedRevision: revision, guild, itemId, quantity },
      );
      setContainers((v) =>
        v.map((c) =>
          c.containerId === containerId
            ? {
                ...c,
                slots: c.slots.map((s) =>
                  s.index === slot.index ? r.slot : s,
                ),
              }
            : c,
        ),
      );
      onSessionUpdate(r.dirty, r.revision);
    } catch (e) {
      setError(
        e instanceof PalSaveApiError && e.status === 409
          ? `${e.message}. Reload before retrying.`
          : String(e),
      );
    }
  }
  if (loading && players.length === 0)
    return (
      <p className="p-4 text-sm text-neutral-400">
        Loading players and containers…
      </p>
    );
  return (
    <div className="space-y-4 rounded border border-neutral-800 p-4">
      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-neutral-400">
          Person
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="ml-2 rounded border border-neutral-700 bg-neutral-950 p-2 text-sm text-white"
          >
            {players.map((p) => (
              <option key={p.playerUid} value={p.playerUid}>
                {p.nickname || p.playerUid}
              </option>
            ))}
          </select>
        </label>
        <div className="flex rounded border border-neutral-700 p-1">
          <button
            onClick={() => setGuild(false)}
            className={`rounded px-3 py-1 text-xs ${!guild ? "bg-sky-800" : ""}`}
          >
            Personal Inventory
          </button>
          <button
            onClick={() => setGuild(true)}
            className={`rounded px-3 py-1 text-xs ${guild ? "bg-sky-800" : ""}`}
          >
            Guild Chests
          </button>
        </div>
      </div>
      {players.length === 0 && (
        <p className="text-sm text-amber-300">
          Upload Level.sav together with one or more files from the Players
          folder.
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && (
        <p className="text-sm text-neutral-400">Loading containers…</p>
      )}
      <div className="space-y-4">
        {containers.map((container) => (
          <section
            key={container.containerId}
            className="rounded border border-neutral-800"
          >
            <header className="border-b border-neutral-800 p-2 text-xs">
              <b>{container.kind}</b>{" "}
              <code className="text-neutral-500">{container.containerId}</code>
            </header>
            <div className="grid gap-2 p-2 sm:grid-cols-2 xl:grid-cols-3">
              {container.slots.map((slot) => (
                <SlotEditor
                  key={slot.index}
                  slot={slot}
                  onSave={(item, qty) =>
                    save(container.containerId, slot, item, qty)
                  }
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      {!loading && selected && containers.length === 0 && (
        <p className="text-sm text-neutral-500">
          No {guild ? "guild-owned chests" : "personal containers"} found.
        </p>
      )}
    </div>
  );
}
function SlotEditor({
  slot,
  onSave,
}: {
  slot: InventorySlot;
  onSave: (item: string, quantity: number) => Promise<void>;
}) {
  const [item, setItem] = useState(slot.itemId ?? ""),
    [quantity, setQuantity] = useState(slot.quantity ?? 0),
    [saving, setSaving] = useState(false);
  return (
    <div className="rounded border border-neutral-800 bg-neutral-950 p-2">
      <p className="mb-1 text-xs text-neutral-500">Slot {slot.index}</p>
      <input
        aria-label={`Item ID slot ${slot.index}`}
        value={item}
        onChange={(e) => setItem(e.target.value)}
        className="mb-1 w-full rounded border border-neutral-700 bg-black p-1.5 text-xs"
        placeholder="Internal item ID"
      />
      <input
        aria-label={`Quantity slot ${slot.index}`}
        type="number"
        min={0}
        value={quantity}
        onChange={(e) => setQuantity(Number(e.target.value))}
        className="w-full rounded border border-neutral-700 bg-black p-1.5 text-xs"
      />
      <div className="mt-2 flex gap-2">
        <button
          disabled={saving || !slot.editable}
          onClick={() => {
            setSaving(true);
            void onSave(item, quantity).finally(() => setSaving(false));
          }}
          className="rounded bg-sky-800 px-2 py-1 text-xs disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          disabled={saving || !slot.editable}
          onClick={() => {
            setItem("");
            setQuantity(0);
            setSaving(true);
            void onSave("", 0).finally(() => setSaving(false));
          }}
          className="rounded border border-neutral-700 px-2 py-1 text-xs"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
