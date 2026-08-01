"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WIKI_CATEGORIES, WIKI_DOCS } from "@/lib/wiki";

const GROUPS = [
  { title: "Game data", pages: WIKI_CATEGORIES },
  { title: "Docs", pages: WIKI_DOCS },
] as const;

/** Sidebar index, kept in the layout so it survives navigation between pages. */
export function WikiNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Wiki" className="space-y-4">
      <Link
        href="/wiki"
        aria-current={pathname === "/wiki" ? "page" : undefined}
        className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          pathname === "/wiki"
            ? "bg-accent-soft text-accent"
            : "text-muted hover:bg-raised hover:text-foreground"
        }`}
      >
        Wiki home
      </Link>

      {GROUPS.map((group) => (
        <div key={group.title}>
          <p className="field-label mb-1.5 px-3">{group.title}</p>
          <div className="space-y-0.5">
            {group.pages.map((page) => {
              const active = pathname === page.href;

              return (
                <Link
                  key={page.href}
                  href={page.href}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-accent-soft font-medium text-accent"
                      : "text-muted hover:bg-raised hover:text-foreground"
                  }`}
                >
                  {page.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
