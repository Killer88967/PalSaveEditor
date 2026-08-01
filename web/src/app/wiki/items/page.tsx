import type { Metadata } from "next";
import { ItemsBrowser } from "@/components/wiki/items-browser";

export const metadata: Metadata = {
  title: "Items",
  description:
    "Every Palworld item ID with type, rarity, stack size, weight and price — the IDs the inventory editor writes.",
};

export default function ItemsWikiPage() {
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Items</h1>
        <p className="text-sm text-muted">Every item in the game data. The ID under each name is what a save stores in an inventory slot, and what the inventory editor writes.</p>
      </header>

      <ItemsBrowser />
    </>
  );
}
