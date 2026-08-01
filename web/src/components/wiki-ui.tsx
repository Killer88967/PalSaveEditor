import { AlertIcon } from "@/components/icons";

/** Title block at the top of every wiki page. */
export function WikiHeader({
  title,
  lead,
}: {
  title: string;
  lead: React.ReactNode;
}) {
  return (
    <header className="space-y-2">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-2xl text-muted">{lead}</p>
    </header>
  );
}

/** Jump list for the long pages; ids must match the sections below it. */
export function OnThisPage({
  sections,
}: {
  sections: readonly { id: string; title: string }[];
}) {
  return (
    <nav aria-label="On this page" className="card p-4">
      <p className="field-label">On this page</p>
      <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        {sections.map((section, index) => (
          <li key={section.id} className="flex gap-2">
            <span className="font-mono text-xs text-subtle">{index + 1}.</span>
            <a href={`#${section.id}`} className="text-accent hover:underline">
              {section.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Section({
  id,
  title,
  children,
}: React.PropsWithChildren<{ id: string; title: string }>) {
  return (
    <section id={id} className="card scroll-mt-20 overflow-hidden">
      <header className="border-b border-line bg-raised px-4 py-3">
        <h2 className="font-medium">
          <a href={`#${id}`} className="hover:text-accent">
            {title}
          </a>
        </h2>
      </header>
      <div className="space-y-3 p-4 text-sm text-muted">{children}</div>
    </section>
  );
}

/** Numbered walkthrough, the shape most of the usage page is written in. */
export function Steps({ items }: { items: readonly React.ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2.5">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-accent-soft font-mono text-xs text-accent">
            {index + 1}
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function Note({
  tone = "accent",
  children,
}: React.PropsWithChildren<{ tone?: "accent" | "warning" }>) {
  return (
    <div
      className={`alert text-xs ${tone === "warning" ? "alert-warning" : "alert-accent"}`}
    >
      <AlertIcon
        className={`mt-0.5 size-4 shrink-0 ${tone === "warning" ? "text-warning" : "text-accent"}`}
      />
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/**
 * Reference table. Wide content scrolls inside its own box so the page body
 * never scrolls sideways on a phone.
 */
export function DataTable({
  columns,
  rows,
  mono = [],
}: {
  columns: readonly string[];
  rows: readonly (readonly React.ReactNode[])[];
  /** Column indexes rendered in the monospace accent style. */
  mono?: readonly number[];
}) {
  return (
    <div className="scroll-slim overflow-x-auto">
      <table className="w-full min-w-120 text-left text-sm">
        <thead className="text-xs text-subtle">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="pb-2 pr-4 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-line align-top">
              {row.map((cell, column) => (
                <td
                  key={column}
                  className={`py-2 pr-4 ${
                    mono.includes(column)
                      ? "whitespace-nowrap font-mono text-xs text-accent"
                      : "text-muted"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
