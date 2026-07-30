"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getApiHealth } from "@/lib/palsave-api";
import { GithubIcon, LogoMark } from "@/components/icons";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/editor", label: "Editor" },
  { href: "/tools", label: "Convert" },
  { href: "/guide", label: "Guide" },
] as const;

const REPOSITORY = "https://github.com/Killer88967/PalSaveEditor";

type ApiState = "checking" | "online" | "offline";

/** Live indicator for the Rust API the whole app depends on. */
function ApiStatus() {
  const [state, setState] = useState<ApiState>("checking");

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function check() {
      try {
        await getApiHealth();
        if (!cancelled) setState("online");
      } catch {
        if (!cancelled) setState("offline");
      }
    }

    void check();
    // The API is a separate process, so keep watching rather than probing once.
    const timer = window.setInterval(() => void check(), 20_000);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  const label = {
    checking: "Checking Rust API…",
    online: "Rust API online",
    offline: "Rust API offline",
  }[state];

  const dot = {
    checking: "bg-subtle animate-pulse-dot",
    online: "bg-success",
    offline: "bg-danger",
  }[state];

  return (
    <span
      className="badge"
      title={label}
      role="status"
      aria-label={label}
      data-state={state}
    >
      <span className={`size-1.5 rounded-full ${dot}`} />
      <span className="hidden sm:inline">
        {state === "offline" ? "API offline" : "API"}
      </span>
    </span>
  );
}

export function SiteHeader() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
        >
          <LogoMark className="size-7 text-accent" />
          <span className="hidden sm:inline">
            PalSave<span className="text-accent">Editor</span>
          </span>
        </Link>

        <nav
          aria-label="Main"
          className="scroll-slim ml-auto flex items-center gap-0.5 overflow-x-auto sm:ml-4 sm:mr-auto"
        >
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3 ${
                isActive(link.href)
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-raised hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <ApiStatus />
          <a
            href={REPOSITORY}
            target="_blank"
            rel="noreferrer noopener"
            className="btn btn-ghost btn-sm"
            aria-label="Open the project on GitHub"
          >
            <GithubIcon className="size-4" />
          </a>
        </div>
      </div>
    </header>
  );
}
