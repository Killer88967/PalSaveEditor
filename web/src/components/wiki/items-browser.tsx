"use client";

import {
  DetailHeader,
  Stat,
  WikiBrowser,
  WikiIcon,
} from "@/components/wiki-browser";
import { humanizeId } from "@/lib/format";
import type { WikiItem } from "@/lib/wiki";

/** `type_a` values worth filtering by; anything else falls under Other. */
const TYPES = [
  "Weapon",
  "Armor",
  "Accessory",
  "Material",
  "Consume",
  "Food",
  "Ammo",
  "Blueprint",
  "MonsterEquipWeapon",
  "Essential",
  "Glider",
  "SphereModule",
];

const SORTS = [
  {
    id: "name",
    label: "Name",
    compare: (a: WikiItem, b: WikiItem) => a.name.localeCompare(b.name),
  },
  {
    id: "rarity",
    label: "Rarity",
    compare: (a: WikiItem, b: WikiItem) =>
      b.rarity - a.rarity || a.name.localeCompare(b.name),
  },
  {
    id: "price",
    label: "Price",
    compare: (a: WikiItem, b: WikiItem) => b.price - a.price,
  },
  {
    id: "weight",
    label: "Weight",
    compare: (a: WikiItem, b: WikiItem) => b.weight - a.weight,
  },
];

export function ItemsBrowser() {
  return (
    <WikiBrowser
      set="items"
      searchPlaceholder="Search items by name or ID…"
      keyOf={(item) => item.id}
      matches={(item, query) =>
        item.name.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query)
      }
      filters={TYPES.map((type) => ({ id: type, label: humanizeId(type) }))}
      passesFilter={(item, filter) => item.typeA === filter}
      sorts={SORTS}
      renderRow={(item) => (
        <>
          <WikiIcon icon={item.icon} alt="" className="size-7" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {item.name}
            </span>
            <span className="block truncate font-mono text-[11px] text-subtle">
              {item.id}
            </span>
          </span>
          {item.rarity > 0 && (
            <span className="shrink-0 text-[11px] text-subtle">
              R{item.rarity}
            </span>
          )}
        </>
      )}
      emptyDetail="Select an item to see its details."
      renderDetail={(item) => (
        <div className="space-y-4">
          <DetailHeader
            icon={item.icon}
            name={item.name}
            id={item.id}
            description={item.description}
            badges={
              <>
                {item.typeA && (
                  <span className="badge">{humanizeId(item.typeA)}</span>
                )}
                {item.typeB && item.typeB !== item.typeA && (
                  <span className="badge">{humanizeId(item.typeB)}</span>
                )}
                {item.rarity > 0 && (
                  <span className="badge badge-accent">
                    Rarity {item.rarity}
                  </span>
                )}
              </>
            }
          />

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Max stack" value={item.maxStack || "—"} />
            <Stat label="Weight" value={item.weight} />
            <Stat label="Price" value={item.price.toLocaleString()} />
            <Stat label="Rank" value={item.rank} />
          </dl>

          <p className="text-xs text-subtle">
            Paste <code className="text-accent">{item.id}</code> into the
            inventory editor&apos;s item ID field to write this item into a
            slot.
          </p>
        </div>
      )}
    />
  );
}
