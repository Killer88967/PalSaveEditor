"use client";

import { useEffect, useState } from "react";
import {
  addInventoryItem,
  getInventoryPlayers,
  getKnownItems,
  getPlayerInventory,
  removeInventorySlot,
  updateInventorySlot,
  PalSaveApiError,
  type InventoryContainer,
  type InventorySlot,
  type KnownItem,
  type PlayerInventoryOwner,
} from "@/lib/palsave-api";
import {
  catalog,
  categoryCounts,
  CATEGORY_LABELS,
  defaultCategoryFor,
  nextFreeSlot,
  searchCatalog,
  type CatalogEntry,
  type ItemCategory,
} from "@/lib/item-catalog";
import { formatCount, humanizeId, shortId } from "@/lib/format";
import { AlertIcon, BagIcon, PlusIcon } from "@/components/icons";

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
  const [items, setItems] = useState<KnownItem[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [settledKey, setSettledKey] = useState<string>();
  const [reloads, setReloads] = useState(0);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  // Derived rather than set inside the effect, so switching player shows the
  // loading state on the very first render after the change.
  const containersKey = selected
    ? `${sessionId}:${selected}:${reloads}`
    : undefined;
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

  // The picker suggests ids this world actually holds, so a typo cannot be
  // mistaken for a real item.
  useEffect(() => {
    const abort = new AbortController();

    void getKnownItems(sessionId, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setItems(value);
      })
      .catch(() => {
        // A missing catalogue only costs suggestions; ids stay typeable.
      });

    return () => abort.abort();
  }, [sessionId]);

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

  /** Container contents shift on every write, so re-read after each one. */
  function settle(dirty: boolean, nextRevision: number, message?: string) {
    setError(undefined);
    setNotice(message);
    setReloads((value) => value + 1);
    onSessionUpdate(dirty, nextRevision);
  }

  function fail(cause: unknown) {
    setNotice(undefined);
    setError(
      cause instanceof PalSaveApiError && cause.status === 409
        ? `${cause.message}. Reload before retrying.`
        : cause instanceof Error
          ? cause.message
          : String(cause),
    );
  }

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
      settle(response.dirty, response.revision);
    } catch (cause) {
      fail(cause);
    }
  }

  async function remove(containerId: string, slot: InventorySlot) {
    try {
      const response = await removeInventorySlot(
        sessionId,
        selected,
        containerId,
        slot.index,
        revision,
      );
      settle(
        response.dirty,
        response.revision,
        `Removed ${response.slot.itemId ?? "the item"} from slot ${response.slot.slotIndex ?? slot.index}.`,
      );
    } catch (cause) {
      fail(cause);
    }
  }

  async function add(
    container: InventoryContainer,
    itemId: string,
    quantity: number,
    slotIndex?: number,
  ) {
    try {
      const response = await addInventoryItem(
        sessionId,
        selected,
        container.containerId,
        { expectedRevision: revision, itemId, quantity, slotIndex },
      );
      const where = `slot ${response.slot.slotIndex ?? "?"} of ${
        CONTAINER_LABELS[container.kind] ?? humanizeId(container.kind)
      }`;
      settle(
        response.dirty,
        response.revision,
        response.warning ??
          (response.dynamicSource
            ? `Added ${itemId} to ${where}, copying the durability of an existing ${response.dynamicSource}.`
            : `Added ${formatCount(quantity)} × ${itemId} to ${where}.`),
      );
    } catch (cause) {
      fail(cause);
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
  const entries = catalog(items);
  const filled = containers.reduce(
    (total, container) => total + container.slots.length,
    0,
  );
  const slots = containers.reduce(
    (total, container) => total + container.capacity,
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
          {entries.length > 0 && (
            <span className="badge">
              {formatCount(entries.length)} item ids in this world
            </span>
          )}
        </div>
      </div>

      {error && (
        <p className="alert alert-danger text-sm" role="alert">
          {error}
        </p>
      )}

      {notice && !error && (
        <p className="alert alert-accent text-sm" role="status">
          {notice}
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
        <ContainerPanel
          key={container.containerId}
          container={container}
          entries={entries}
          onAdd={(itemId, quantity, slotIndex) =>
            add(container, itemId, quantity, slotIndex)
          }
          onSave={(slot, itemId, quantity) =>
            save(container.containerId, slot, itemId, quantity)
          }
          onRemove={(slot) => remove(container.containerId, slot)}
        />
      ))}

      <p className="text-xs text-subtle">
        Item identifiers are Palworld&apos;s internal names, e.g.{" "}
        <code>PalSphere</code> or <code>KeySphere_01</code>. Suggestions come
        from this save, so they are guaranteed to be real ids — any other id is
        written faithfully, but the game will ignore one it does not know.
      </p>
    </div>
  );
}

function ContainerPanel({
  container,
  entries,
  onAdd,
  onSave,
  onRemove,
}: {
  container: InventoryContainer;
  entries: CatalogEntry[];
  onAdd: (
    itemId: string,
    quantity: number,
    slotIndex?: number,
  ) => Promise<void>;
  onSave: (
    slot: InventorySlot,
    itemId: string,
    quantity: number,
  ) => Promise<void>;
  onRemove: (slot: InventorySlot) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);

  const free = nextFreeSlot(
    container.capacity,
    container.slots.map((slot) => slot.slotIndex),
  );
  const full = free === undefined;

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-4 py-2.5">
        <BagIcon className="size-4 text-accent" />
        <h3 className="text-sm font-medium">
          {CONTAINER_LABELS[container.kind] ?? humanizeId(container.kind)}
        </h3>
        <code className="text-xs text-subtle" title={container.containerId}>
          {shortId(container.containerId)}
        </code>
        <span className="badge ml-auto">
          {container.slots.length} / {container.capacity} slots
        </span>
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          disabled={full && !adding}
          className="btn btn-secondary btn-sm"
          aria-expanded={adding}
        >
          <PlusIcon className="size-3.5" />
          {full ? "Full" : adding ? "Close" : "Add item"}
        </button>
      </header>

      {adding && !full && (
        <AddItemForm
          entries={entries}
          containerKind={container.kind}
          capacity={container.capacity}
          nextSlot={free}
          taken={container.slots.map((slot) => slot.slotIndex)}
          onAdd={async (itemId, quantity, slotIndex) => {
            await onAdd(itemId, quantity, slotIndex);
            setAdding(false);
          }}
        />
      )}

      <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {container.slots.map((slot) => (
          <SlotEditor
            key={`${slot.index}:${slot.slotIndex}`}
            slot={slot}
            onSave={(itemId, quantity) => onSave(slot, itemId, quantity)}
            onRemove={() => onRemove(slot)}
          />
        ))}
        {container.slots.length === 0 && (
          <p className="text-sm text-subtle">
            This container is empty. {full ? "" : "Use “Add item” to fill it."}
          </p>
        )}
      </div>
    </section>
  );
}

function AddItemForm({
  entries,
  containerKind,
  capacity,
  nextSlot,
  taken,
  onAdd,
}: {
  entries: CatalogEntry[];
  containerKind: string;
  capacity: number;
  nextSlot: number;
  taken: (number | undefined)[];
  onAdd: (
    itemId: string,
    quantity: number,
    slotIndex?: number,
  ) => Promise<void>;
}) {
  const [category, setCategory] = useState<ItemCategory | undefined>(
    defaultCategoryFor(containerKind),
  );
  const [query, setQuery] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [slot, setSlot] = useState<"auto" | number>("auto");
  const [busy, setBusy] = useState(false);

  const counts = categoryCounts(entries);
  const results = searchCatalog(entries, query, category, 24);
  const selected = entries.find((entry) => entry.itemId === itemId);
  const occupied = new Set(taken.filter((value) => value !== undefined));
  const freeSlots = Array.from({ length: capacity }, (_, index) => index)
    .filter((index) => !occupied.has(index))
    .slice(0, 200);

  return (
    <form
      className="space-y-3 border-b border-line bg-sunken p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!itemId.trim() || busy) return;
        setBusy(true);
        void onAdd(
          itemId.trim(),
          quantity,
          slot === "auto" ? undefined : slot,
        ).finally(() => setBusy(false));
      }}
    >
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setCategory(undefined)}
          className={`badge ${category === undefined ? "badge-accent" : ""}`}
        >
          All
        </button>
        {counts.map((entry) => (
          <button
            key={entry.category}
            type="button"
            onClick={() => setCategory(entry.category)}
            className={`badge ${category === entry.category ? "badge-accent" : ""}`}
          >
            {CATEGORY_LABELS[entry.category]}
            <span className="text-subtle"> {entry.count}</span>
          </button>
        ))}
      </div>

      <label className="block">
        <span className="field-label">Search this world&apos;s item ids</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="e.g. key sphere"
          className="field field-sm"
        />
      </label>

      {results.length > 0 && (
        <ul className="scroll-slim max-h-44 overflow-y-auto rounded-[calc(var(--radius)-2px)] border border-line">
          {results.map((entry) => (
            <li key={entry.itemId}>
              <button
                type="button"
                onClick={() => setItemId(entry.itemId)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                  entry.itemId === itemId ? "bg-accent-soft" : "hover:bg-raised"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {humanizeId(entry.itemId)}
                  </span>
                  <code className="block truncate text-xs text-subtle">
                    {entry.itemId}
                  </code>
                </span>
                {entry.hasDynamicTemplate && (
                  <span
                    className="badge shrink-0"
                    title="Durability data available"
                  >
                    gear
                  </span>
                )}
                <span className="shrink-0 text-xs text-subtle tabular-nums">
                  {formatCount(entry.stacks)}×
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {query && results.length === 0 && (
        <p className="text-xs text-subtle">
          Nothing in this world matches. You can still type an id below.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-52 flex-1">
          <span className="field-label">Item ID</span>
          <input
            value={itemId}
            onChange={(event) => setItemId(event.target.value)}
            placeholder="KeySphere_01"
            required
            className="field field-sm font-mono"
          />
        </label>

        <label className="w-28">
          <span className="field-label">Quantity</span>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(event) =>
              setQuantity(Math.max(1, Number(event.target.value) || 1))
            }
            className="field field-sm tabular-nums"
          />
        </label>

        <label className="w-36">
          <span className="field-label">Slot</span>
          <select
            value={slot}
            onChange={(event) =>
              setSlot(
                event.target.value === "auto"
                  ? "auto"
                  : Number(event.target.value),
              )
            }
            className="field field-sm tabular-nums"
          >
            <option value="auto">First free ({nextSlot})</option>
            {freeSlots.map((index) => (
              <option key={index} value={index}>
                Slot {index}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={busy || !itemId.trim()}
          className="btn btn-primary btn-sm"
        >
          {busy ? "Adding…" : "Add to container"}
        </button>
      </div>

      {selected?.hasDynamicTemplate && (
        <p className="text-xs text-muted">
          This world already holds a <code>{selected.itemId}</code>, so the new
          one is created with a copy of its durability, ammo and passive data.
        </p>
      )}

      {itemId && !selected && (
        <p className="text-xs text-warning">
          <code>{itemId}</code> is not present anywhere in this save. It will be
          written exactly as typed; equipment added this way has no durability
          data and may not behave in game.
        </p>
      )}
    </form>
  );
}

function SlotEditor({
  slot,
  onSave,
  onRemove,
}: {
  slot: InventorySlot;
  onSave: (itemId: string, quantity: number) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [itemId, setItemId] = useState(slot.itemId ?? "");
  const [quantity, setQuantity] = useState(slot.quantity ?? 0);
  const [saving, setSaving] = useState(false);

  const dirty =
    itemId !== (slot.itemId ?? "") || quantity !== (slot.quantity ?? 0);

  return (
    <div
      className={`panel p-3 transition-colors ${dirty ? "border-accent" : ""}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-subtle">
          Slot {slot.slotIndex ?? slot.index}
        </p>
        {slot.dynamic && (
          <span className="badge" title="Has durability, ammo or passive data">
            Gear
          </span>
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
          disabled={!slot.editable || slot.dynamic}
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
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void onRemove().finally(() => setSaving(false));
          }}
          className="btn btn-ghost btn-sm"
        >
          Remove
        </button>
      </div>

      {slot.dynamic && (
        <p className="mt-2 text-xs text-subtle">
          Swapping the id would orphan this item&apos;s durability record, so
          only its quantity is editable. Remove it and add the replacement.
        </p>
      )}

      {!slot.editable && (
        <p className="mt-2 text-xs text-warning">
          This slot&apos;s raw layout was not recognised, so it is read-only.
        </p>
      )}
    </div>
  );
}
