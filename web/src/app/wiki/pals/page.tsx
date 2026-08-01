import type { Metadata } from "next";
import { PalsBrowser } from "@/components/wiki/pals-browser";

export const metadata: Metadata = {
  title: "Pals",
  description:
    "Every Palworld character: elements, stat scaling, work suitability, learned skills and innate passives, searchable by name or CharacterID.",
};

export default function PalsWikiPage() {
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Pals</h1>
        <p className="text-sm text-muted">
          Every character in the game data, including bosses and humans. The ID
          under each name is the <code>CharacterID</code> the save stores.
        </p>
      </header>

      <PalsBrowser />
    </>
  );
}
