import Link from "next/link";
import { LostPal } from "@/components/notFound/lost-pal";

export function NotFoundPanel() {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <LostPal />
      <h1 className="mt-6 text-2xl font-semibold">This page wandered off</h1>
      <p className="mt-2 text-muted">
        Depresso can&apos;t find what you&apos;re looking for. The page may have
        been moved, renamed, or captured by a wild Pal.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
        <Link href="/" className="btn btn-primary">
          Back home
        </Link>
        <Link href="/editor" className="btn btn-secondary">
          Open the editor
        </Link>
        <Link href="/wiki" className="btn btn-ghost">
          Browse the wiki
        </Link>
      </div>
    </section>
  );
}
