import type { Metadata } from "next";
import { BuildingsBrowser } from "@/components/wiki/reference-browsers";

export const metadata: Metadata = {
  title: "Buildings",
  description:
    "Palworld build recipes: materials, durability, defence and power requirements.",
};

export default function BuildingsWikiPage() {
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Buildings</h1>
        <p className="text-sm text-muted">Base structures with their build materials and durability.</p>
      </header>

      <BuildingsBrowser />
    </>
  );
}
