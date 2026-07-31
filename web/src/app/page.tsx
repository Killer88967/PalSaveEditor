import Link from "next/link";
import {
  AlertIcon,
  ArrowRightIcon,
  BagIcon,
  BoltIcon,
  ChartIcon,
  CheckIcon,
  PackIcon,
  PalIcon,
  ShieldIcon,
  TreeIcon,
  UnpackIcon,
} from "@/components/icons";

/**
 * Numbers from the sample world checked into `EXData/`. They are shown as a
 * worked example of the container decode, not as the visitor's own data.
 */
const SAMPLE = {
  name: "Level.sav",
  compressed: 498_401,
  uncompressed: 7_059_486,
  headerRows: [
    {
      offset: "00",
      bytes: "1E B8 6B 00",
      field: "uncompressed",
      value: "7,059,486",
    },
    {
      offset: "04",
      bytes: "D5 9A 07 00",
      field: "compressed",
      value: "498,389",
    },
    { offset: "08", bytes: "50 6C 4D", field: "magic", value: "PlM" },
    { offset: "0B", bytes: "31", field: "type", value: "Oodle Kraken" },
  ],
} as const;

const CAPABILITIES = [
  {
    icon: UnpackIcon,
    title: "Decompile to GVAS",
    body: "Strip the Palworld container and get the raw Unreal GVAS payload — the exact bytes the game compresses — for diffing or external tooling.",
  },
  {
    icon: PackIcon,
    title: "Recompile to .sav",
    body: "Pack GVAS back into a loadable container. The payload is re-parsed before it is written, so a corrupt edit fails here instead of in-game.",
  },
  {
    icon: PalIcon,
    title: "Edit Pals",
    body: "Search 170+ characters by species, nickname or instance ID, then change level, star rank, gender, IVs, souls and skill lists.",
  },
  {
    icon: BagIcon,
    title: "Edit inventories",
    body: "Walk each player's personal containers — pack, key items, weapon loadout, armour and food slots — add or remove items in any free slot, and rewrite IDs and stack counts.",
  },
  {
    icon: TreeIcon,
    title: "Browse the raw tree",
    body: "Page through every property in the save with types, child counts and byte lengths, and edit any scalar the parser understands.",
  },
  {
    icon: ChartIcon,
    title: "See the whole world",
    body: "A dashboard sizes every worldSaveData collection and digests the character map: species leaders, level spread and per-player Pal counts.",
  },
] as const;

const STEPS = [
  {
    title: "Back up first",
    body: "Copy your entire world folder somewhere safe. This is the only step that cannot be undone for you.",
  },
  {
    title: "Upload Level.sav",
    body: "Add the player .sav files alongside it to unlock inventory editing. Everything is parsed in memory by the Rust API.",
  },
  {
    title: "Inspect and edit",
    body: "Work through the dashboard, the Pal list, inventories or the raw property tree. Each edit bumps a revision so stale writes are rejected.",
  },
  {
    title: "Export and verify",
    body: "Download a validated .sav — it is re-parsed after writing — then drop it back into your world folder and load the game.",
  },
] as const;

const GUARANTEES = [
  {
    icon: ShieldIcon,
    title: "Runs where you run it",
    body: "Saves are held in the API process's memory, never written to disk, and dropped when the container restarts.",
  },
  {
    icon: BoltIcon,
    title: "Rust parser, paged UI",
    body: "A 7 MB save expands to hundreds of thousands of properties. The tree is served page by page instead of shipped as one JSON blob.",
  },
  {
    icon: CheckIcon,
    title: "Validated round trip",
    body: "Exports are decompressed and re-parsed before you get the file, so a save that cannot be read never reaches your game.",
  },
] as const;

function HeaderDecode() {
  const ratio = SAMPLE.uncompressed / SAMPLE.compressed;

  return (
    <div className="card glow overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line bg-raised px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-danger/70" />
          <span className="size-2.5 rounded-full bg-warning/70" />
          <span className="size-2.5 rounded-full bg-success/70" />
        </span>
        <p className="ml-1 font-mono text-xs text-muted">
          container decode — {SAMPLE.name}
        </p>
      </div>

      <div className="overflow-x-auto p-4">
        <table className="w-full min-w-88 border-collapse font-mono text-xs">
          <caption className="sr-only">
            The twelve header bytes of a Palworld save container
          </caption>
          <thead>
            <tr className="text-subtle">
              <th scope="col" className="pb-2 pr-3 text-left font-normal">
                off
              </th>
              <th scope="col" className="pb-2 pr-3 text-left font-normal">
                bytes
              </th>
              <th scope="col" className="pb-2 pr-3 text-left font-normal">
                field
              </th>
              <th scope="col" className="pb-2 text-right font-normal">
                value
              </th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE.headerRows.map((row) => (
              <tr key={row.offset} className="border-t border-line/70">
                <td className="py-1.5 pr-3 text-subtle">{row.offset}</td>
                <td className="py-1.5 pr-3 text-violet">{row.bytes}</td>
                <td className="py-1.5 pr-3 text-muted">{row.field}</td>
                <td className="py-1.5 text-right text-accent">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 border-t border-line bg-sunken px-4 py-3">
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-muted">486.7 KB on disk</span>
          <span className="font-mono text-accent">
            {ratio.toFixed(2)}× expansion
          </span>
          <span className="text-muted">6.7 MB of GVAS</span>
        </div>
        <div className="meter" aria-hidden="true">
          <span style={{ width: "100%" }} />
        </div>
        <p className="text-xs text-subtle">
          4 root properties · 21 world collections · 172 characters · 1,207 item
          containers
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      {/* Hero ------------------------------------------------------------- */}
      <section className="relative overflow-hidden border-b border-line">
        <div
          className="bg-grid pointer-events-none absolute inset-0 opacity-60 mask-[radial-gradient(ellipse_at_50%_0%,black,transparent_72%)]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute left-1/2 -top-56 size-136 -translate-x-1/2 rounded-full bg-accent/12 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="animate-in space-y-7">
            <span className="badge badge-accent">
              <span className="size-1.5 rounded-full bg-accent" />
              Rust parser · zlib &amp; Oodle Kraken containers
            </span>

            <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              Take your Palworld save
              <br />
              <span className="text-gradient">apart and back together.</span>
            </h1>

            <p className="max-w-xl text-lg leading-relaxed text-muted">
              PalSaveEditor decompresses{" "}
              <code className="text-accent">Level.sav</code>, parses the Unreal
              property tree, lets you edit Pals, inventories and individual
              scalars, then recompiles a container the game will actually load.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Link href="/editor" className="btn btn-primary btn-lg">
                Open the editor
                <ArrowRightIcon className="size-4" />
              </Link>
              <Link href="/tools" className="btn btn-secondary btn-lg">
                <UnpackIcon className="size-4" />
                Just decompile a file
              </Link>
            </div>

            <dl className="grid max-w-lg grid-cols-3 gap-4 border-t border-line pt-6">
              {[
                { label: "Container formats", value: "PlZ + PlM" },
                { label: "Editable surfaces", value: "4" },
                { label: "Uploads leave the box", value: "Never" },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="text-xs text-subtle">{stat.label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold sm:text-base">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div
            className="animate-in lg:pl-4"
            style={{ animationDelay: "120ms" }}
          >
            <HeaderDecode />
          </div>
        </div>
      </section>

      {/* Warning ---------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6">
        <div className="alert alert-warning">
          <AlertIcon className="mt-0.5 size-5 shrink-0 text-warning" />
          <p>
            <strong className="font-semibold">Back up your world first.</strong>{" "}
            This project is experimental and writes a different compression
            variant than the game does. Copy your entire save directory before
            you edit anything — a bad write can cost a world.{" "}
            <Link href="/guide" className="text-accent underline">
              Where saves live
            </Link>
          </p>
        </div>
      </section>

      {/* Capabilities ----------------------------------------------------- */}
      <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-accent">What it does</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Six ways into the same save
          </h2>
          <p className="mt-3 text-muted">
            Every view reads from one parsed tree in memory, so a change made in
            the Pal editor is visible in the raw property browser and lands in
            the same export.
          </p>
        </div>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ icon: Glyph, title, body }) => (
            <li key={title} className="card card-hover p-5">
              <span className="inline-flex rounded-lg bg-accent-soft p-2 text-accent">
                <Glyph className="size-5" />
              </span>
              <h3 className="mt-3.5 font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                {body}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* Workflow --------------------------------------------------------- */}
      <section className="border-y border-line bg-sunken">
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-accent">How it works</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              Four steps, one of them yours
            </h2>
          </div>

          <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="card relative p-5">
                <span className="font-mono text-sm text-subtle">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Guarantees ------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-sm font-medium text-accent">Why trust it</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              The boring guarantees that matter
            </h2>
            <p className="mt-3 text-muted">
              A save editor is only useful if it hands back a file the game can
              open. The pipeline is built to fail loudly on the server rather
              than quietly in your world.
            </p>
            <Link href="/guide" className="btn btn-secondary mt-6">
              Read the format notes
              <ArrowRightIcon className="size-4" />
            </Link>
          </div>

          <ul className="space-y-3">
            {GUARANTEES.map(({ icon: Glyph, title, body }) => (
              <li key={title} className="card flex gap-4 p-5">
                <span className="inline-flex h-fit rounded-lg bg-accent-soft p-2 text-accent">
                  <Glyph className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA -------------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-7xl px-4 pb-20 sm:px-6">
        <div className="card relative overflow-hidden p-8 text-center sm:p-12">
          <div
            className="bg-grid pointer-events-none absolute inset-0 opacity-40 mask-[radial-gradient(ellipse_at_center,black,transparent_70%)]"
            aria-hidden="true"
          />
          <div className="relative space-y-5">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Ready when your backup is
            </h2>
            <p className="mx-auto max-w-xl text-muted">
              Load a world, read what is actually inside it, change what you
              meant to change, and export something you can trust.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/editor" className="btn btn-primary btn-lg">
                Open the editor
                <ArrowRightIcon className="size-4" />
              </Link>
              <Link href="/guide" className="btn btn-secondary btn-lg">
                Find my save folder
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
