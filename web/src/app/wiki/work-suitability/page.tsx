import type { Metadata } from "next";
import { WorkSuitabilityBrowser } from "@/components/wiki/reference-browsers";

export const metadata: Metadata = {
  title: "Work suitability",
  description:
    "Palworld base jobs and every Pal that can perform each one, ranked by work level.",
};

export default function WorkSuitabilityWikiPage() {
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Work suitability
        </h1>
        <p className="text-sm text-muted">
          Base jobs, and every Pal that can do each one.
        </p>
      </header>

      <WorkSuitabilityBrowser />
    </>
  );
}
