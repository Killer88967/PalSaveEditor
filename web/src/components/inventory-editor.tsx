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
import { humanizeId, shortId } from "@/lib/format";
import { AlertIcon, BagIcon } from "@/components/icons";

/** Friendlier names for the container ids Palworld uses internally. */
const CONTAINER_LABELS: Record<string, string> = {
  CommonContainerId: "Backpack",
  DropSlotContainerId: "Drop slots",
  EssentialContainerId: "Key items",
  WeaponLoadOutContainerId: "Weapon loadout",
  PlayerEquipArmorContainerId: "Armour",
  FoodEquipContainerId: "Food slots",
};

export function InventoryEditor({
  sessionId,
  revision,
  focusPlayerUid,
  onSessionUpdate,
}: {
  sessionId: string;
  revision: number;
  /** Pre-selects a player, e.g. after clicking a row in the overview. */
  focusPlayerUid?: string;
  onSessionUpdate: (dirty: boolean, revision: number) => void;
}) {
  const [players, setPlayers] = useState<PlayerInventoryOwner[]>([]);
  const [selected, setSelected] = useState("");
  const [containers, setContainers] = useState<InventoryContainer[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [settledKey, setSettledKey] = useState<string>();
  const [error, setError] = useState<string>();

  // Derived rather than set inside the effect, so switching player shows the
  // loading state on the very first render after the change.
  const containersKey = selected ? `${sessionId}:${selected}` : undefined;
  const loading = containersKey !== undefined && settledKey !== containersKey;

  useEffect(() => {
    const abort = new AbortController();

    void getInventoryPlayers(sessionId, abort.signal)
      .then((value) => {
        if (abort.signal.aborted) return;
        setPlayers(value);
        // Honour the requested player when the upload actually included them.
        const requested = focusPlayerUid
          ? value.find(
              (player) =>
                player.playerUid.toLowerCase() === focusPlayerUid.toLowerCase(),
            )
          : undefined;
        setSelected(requested?.playerUid ?? value[0]?.playerUid ?? "");
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) setError(String(cause));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadingPlayers(false);
      });

    return () => abort.abort();
  }, [sessionId, focusPlayerUid]);

  useEffect(() => {
    if (!selected || !containersKey) return;
    const abort = new AbortController();

    void getPlayerInventory(sessionId, selected, abort.signal)
      .then((value) => {
        if (abort.signal.aborted) return;
        setContainers(value);
        setError(undefined);
        setSettledKey(containersKey);
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted) return;
        setContainers([]);
        setError(String(cause));
        setSettledKey(containersKey);
      });

    return () => abort.abort();
  }, [selected, sessionId, containersKey]);

  async function save(
    containerId: string,
    slot: InventorySlot,
    itemId: string,
    quantity: number,
  ) {
    try {
      const response = await updateInventorySlot(
        sessionId,
        selected,
        containerId,
        slot.index,
        { expectedRevision: revision, itemId, quantity },
      );
      setContainers((state) =>
        state.map((container) =>
          container.containerId === containerId
            ? {
                ...container,
                slots: container.slots.map((entry) =>
                  entry.index === slot.index ? response.slot : entry,
                ),
              }
            : container,
        ),
      );
      setError(undefined);
      onSessionUpdate(response.dirty, response.revision);
    } catch (cause) {
      setError(
        cause instanceof PalSaveApiError && cause.status === 409
          ? `${cause.message}. Reload before retrying.`
          : String(cause),
      );
    }
  }

  if (loadingPlayers) {
    return (
      <div className="card p-8 text-center text-sm text-muted">
        Loading players and containers…
      </div>
    );
  }

  if (players.length === 0) {
    return (
      <div className="alert alert-warning">
        <AlertIcon className="mt-0.5 size-5 shrink-0 text-warning" />
        <div>
          <p className="font-medium">No player save files in this session</p>
          <p className="mt-1 text-muted">
            Inventories live in the individual <code>Players/*.sav</code> files.
            Re-upload with <code className="text-accent">Level.sav</code> and
            the contents of the <code>Players</code> folder selected together.
          </p>
        </div>
      </div>
    );
  }

  const owner = players.find((player) => player.playerUid === selected);
  const filled = containers.reduce(
    (total, container) =>
      total + container.slots.filter((slot) => slot.itemId).length,
    0,
  );
  const slots = containers.reduce(
    (total, container) => total + container.slots.length,
    0,
  );

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-4 p-4">
        <label className="min-w-56">
          <span className="field-label">Player</span>
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className="field"
          >
            {players.map((player) => (
              <option key={player.playerUid} value={player.playerUid}>
                {player.nickname || shortId(player.playerUid)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2 pb-1">
          {owner && (
            <span className="badge" title={owner.playerUid}>
              <span className="font-mono">{shortId(owner.playerUid)}</span>
            </span>
          )}
          <span className="badge">
            {containers.length} container{containers.length === 1 ? "" : "s"}
          </span>
          <span className="badge badge-accent">
            {filled} / {slots} slots filled
          </span>
        </div>
      </div>

      {error && (
        <p className="alert alert-danger text-sm" role="alert">
          {error}
        </p>
      )}

      {loading && (
        <p className="text-sm text-muted" role="status">
          Loading containers…
        </p>
      )}

      {!loading && containers.length === 0 && (
        <div className="card p-8 text-center text-sm text-subtle">
          No personal containers were found for this player.
        </div>
      )}

      {containers.map((container) => (
        <section key={container.containerId} className="card overflow-hidden">
          <header className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-4 py-2.5">
            <BagIcon className="size-4 text-accent" />
            <h3 className="text-sm font-medium">
              {CONTAINER_LABELS[container.kind] ?? humanizeId(container.kind)}
            </h3>
            <code className="text-xs text-subtle" title={container.containerId}>
              {shortId(container.containerId)}
            </code>
            <span className="badge ml-auto">
              {container.slots.filter((slot) => slot.itemId).length} /{" "}
              {container.slots.length}
            </span>
          </header>

          <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {container.slots.map((slot) => (
              <SlotEditor
                key={slot.index}
                slot={slot}
                onSave={(itemId, quantity) =>
                  save(container.containerId, slot, itemId, quantity)
                }
              />
            ))}
            {container.slots.length === 0 && (
              <p className="text-sm text-subtle">
                This container has no slots.
              </p>
            )}
          </div>
        </section>
      ))}

      <p className="text-xs text-subtle">
        Item identifiers are Palworld&apos;s internal names, e.g.{" "}
        <code>PalSphere</code> or <code>Wood</code>. An unknown id will be
        written faithfully but the game may ignore it — clearing a slot is the
        safe way to remove an item.
      </p>
    </div>
  );
}

function SlotEditor({
  slot,
  onSave,
}: {
  slot: InventorySlot;
  onSave: (itemId: string, quantity: number) => Promise<void>;
}) {
  const [itemId, setItemId] = useState(slot.itemId ?? "");
  const [quantity, setQuantity] = useState(slot.quantity ?? 0);
  const [saving, setSaving] = useState(false);

  const dirty =
    itemId !== (slot.itemId ?? "") || quantity !== (slot.quantity ?? 0);
  const empty = !slot.itemId;

  return (
    <div
      className={`panel p-3 transition-colors ${dirty ? "border-accent" : ""}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-subtle">Slot {slot.index}</p>
        {empty ? (
          <span className="badge">Empty</span>
        ) : (
          <span className="badge badge-accent">Filled</span>
        )}
      </div>

      <label className="block">
        <span className="sr-only">Item ID for slot {slot.index}</span>
        <input
          aria-label={`Item ID slot ${slot.index}`}
          value={itemId}
          onChange={(event) => setItemId(event.target.value)}
          className="field field-sm mb-1.5 font-mono"
          placeholder="Internal item ID"
          disabled={!slot.editable}
        />
      </label>

      <label className="block">
        <span className="sr-only">Quantity for slot {slot.index}</span>
        <input
          aria-label={`Quantity slot ${slot.index}`}
          type="number"
          min={0}
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
          className="field field-sm tabular-nums"
          disabled={!slot.editable}
        />
      </label>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={saving || !slot.editable || !dirty}
          onClick={() => {
            setSaving(true);
            void onSave(itemId, quantity).finally(() => setSaving(false));
          }}
          className="btn btn-primary btn-sm"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving || !slot.editable || empty}
          onClick={() => {
            setItemId("");
            setQuantity(0);
            setSaving(true);
            void onSave("", 0).finally(() => setSaving(false));
          }}
          className="btn btn-ghost btn-sm"
        >
          Clear
        </button>
      </div>

      {!slot.editable && (
        <p className="mt-2 text-xs text-warning">
          This slot&apos;s raw layout was not recognised, so it is read-only.
        </p>
      )}
    </div>
  );
}
