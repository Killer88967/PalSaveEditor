import Link from "next/link";
import { LogoMark } from "@/components/icons";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-sunken">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2 font-semibold">
            <LogoMark className="size-6 text-accent" />
            PalSave<span className="-ml-1 text-accent">Editor</span>
          </div>
          <p className="max-w-sm text-sm text-muted">
            An open-source decompiler, recompiler and editor for Palworld save
            files. Parsing runs in Rust; your saves stay on the machine running
            the editor.
          </p>
        </div>

        <nav className="space-y-2 text-sm" aria-label="Application">
          <p className="font-medium">App</p>
          {[
            { href: "/editor", label: "Save editor" },
            { href: "/tools", label: "Decompile & recompile" },
            { href: "/guide", label: "Guide & save locations" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block text-muted transition-colors hover:text-accent"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <nav className="space-y-2 text-sm" aria-label="Project">
          <p className="font-medium">Project</p>
          <a
            href="https://github.com/Killer88967/PalSaveEditor"
            target="_blank"
            rel="noreferrer noopener"
            className="block text-muted transition-colors hover:text-accent"
          >
            Source on GitHub
          </a>
          <a
            href="https://github.com/Killer88967/PalSaveEditor/issues"
            target="_blank"
            rel="noreferrer noopener"
            className="block text-muted transition-colors hover:text-accent"
          >
            Report an issue
          </a>
          <a
            href="https://github.com/trumank/uesave-rs"
            target="_blank"
            rel="noreferrer noopener"
            className="block text-muted transition-colors hover:text-accent"
          >
            Built on uesave-rs
          </a>
        </nav>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-4 py-4 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Not affiliated with, endorsed by, or sponsored by Pocketpair, Inc.
            Palworld is a trademark of its respective owner.
          </p>
          <p>Always back up your saves before editing.</p>
        </div>
      </div>
    </footer>
  );
}
