import type { Metadata } from "next";
import { ElementsBrowser } from "@/components/wiki/reference-browsers";

export const metadata: Metadata = {
  title: "Elements",
  description:
    "The nine Palworld element types, their colours and every Pal that belongs to each.",
};

export default function ElementsWikiPage() {
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Elements</h1>
        <p className="text-sm text-muted">The nine element types and their members.</p>
      </header>

      <ElementsBrowser />
    </>
  );
}
