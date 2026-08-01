import type { Metadata } from "next";
import { TechnologiesBrowser } from "@/components/wiki/reference-browsers";

export const metadata: Metadata = {
  title: "Technologies",
  description:
    "Palworld technology tree: unlock level, point cost, prerequisites and what each entry unlocks.",
};

export default function TechnologiesWikiPage() {
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Technologies</h1>
        <p className="text-sm text-muted">Technology tree entries, ordered by the level that unlocks them.</p>
      </header>

      <TechnologiesBrowser />
    </>
  );
}
