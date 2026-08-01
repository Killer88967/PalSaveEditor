import type { Metadata } from "next";
import Link from "next/link";
import { WikiNav } from "@/components/wiki-nav";
import { ArrowRightIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: { default: "Wiki", template: "%s · Wiki · PalSaveEditor" },
  description:
    "Documentation for PalSaveEditor: loading a world, editing Pals, players and inventories, the Palworld save format, and answers to common questions.",
};

export default function WikiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:flex">
      <aside className="mb-6 shrink-0 lg:sticky lg:top-20 lg:mb-0 lg:h-fit lg:w-56">
        <WikiNav />
        <div className="mt-4 border-t border-line pt-4">
          <p className="field-label mb-2">Elsewhere</p>
          <Link
            href="/guide"
            className="block rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-foreground"
          >
            Save locations &amp; backups
          </Link>
          <Link
            href="/editor"
            className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-accent transition-colors hover:bg-raised"
          >
            Open the editor
            <ArrowRightIcon className="size-3.5" />
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-6">{children}</div>
    </div>
  );
}
