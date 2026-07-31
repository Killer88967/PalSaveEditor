import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  ShieldIcon,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "Guide",
  description:
    "Where Palworld keeps its save files, how to back them up safely, what PalSaveEditor can and cannot change, and how the .sav container works.",
};

const LOCATIONS = [
  {
    platform: "Steam on Windows",
    path: "%LOCALAPPDATA%\\Pal\\Saved\\SaveGames\\<SteamID64>\\<WorldID>\\",
    note: "Paste the path into Explorer's address bar. There is one numbered folder per Steam account and one per world.",
  },
  {
    platform: "Xbox / Game Pass on Windows",
    path: "%LOCALAPPDATA%\\Packages\\PocketpairInc.Palworld_<suffix>\\SystemAppData\\wgs\\",
    note: "Game Pass stores saves in an obfuscated container layout with no .sav extensions, so this editor generally cannot read them directly.",
  },
  {
    platform: "Dedicated server",
    path: "<server folder>/Pal/Saved/SaveGames/0/<WorldID>/",
    note: "Stop the server before copying or replacing files — a running server will overwrite your changes on its next autosave.",
  },
  {
    platform: "Steam on Linux / Steam Deck",
    path: "~/.steam/steam/steamapps/compatdata/1623730/pfx/drive_c/users/steamuser/AppData/Local/Pal/Saved/SaveGames/",
    note: "Palworld runs under Proton, so the Windows layout appears inside the prefix. 1623730 is Palworld's Steam app ID.",
  },
] as const;

const WORLD_FILES = [
  {
    name: "Level.sav",
    role: "The world itself: every character, base, container and map object. Required by the editor.",
  },
  {
    name: "Players/<uid>.sav",
    role: "One file per player, holding their inventory container references. Needed for inventory editing.",
  },
  {
    name: "LevelMeta.sav",
    role: "World name, in-game day and the thumbnail the load screen shows. Not read by this editor.",
  },
  {
    name: "WorldOption.sav",
    role: "The world's difficulty and rate settings. Not read by this editor.",
  },
] as const;

const SUPPORTED = [
  "Pal and player level, star rank and gender",
  "Souls (Rank_HP, Attack, Defence, CraftSpeed) and IVs (Talent_*)",
  "Nicknames and passive / active skill ID lists",
  "Player inventory slots: item ID and stack quantity",
  "Adding items to any free slot, including key items, and removing them",
  "Duplicating gear the world already holds, durability and passives included",
  "Any individual scalar in the property tree the parser understands",
] as const;

const UNSUPPORTED = [
  "Adding or deleting characters, bases or containers",
  "Creating gear from nothing: equipment needs a durability record to copy",
  "Creating fields that are not already present in an entry",
  "Guild membership, technology points and base layouts",
  "Anything stored inside a collection the parser left as raw bytes",
] as const;

const TROUBLESHOOTING = [
  {
    question: "“not a Palworld save: bad magic”",
    answer:
      "The file is not a Palworld container. Check you picked Level.sav from a world folder and not a .bak, a Game Pass container file, or a save from another game.",
  },
  {
    question: "“the upload must include Level.sav”",
    answer:
      "The editor keys everything off the world file. Select Level.sav together with the Players folder contents in a single drop.",
  },
  {
    question: "“Revision conflict (409)”",
    answer:
      "Two edits raced, usually because a panel was showing older session metadata. The editor refreshes the revision for you — retry the edit once.",
  },
  {
    question: "Some fields are missing or read-only",
    answer:
      "That entry does not contain them, or its raw layout was not recognised. The editor never invents properties, so a partial row stays partial rather than being reshaped.",
  },
  {
    question: "The game will not load my exported save",
    answer:
      "Restore your backup, then report the file. Exports are re-parsed before download, so a rejection points at something the writer got wrong rather than at your edit.",
  },
] as const;

function Card({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return (
    <section className="card overflow-hidden">
      <header className="border-b border-line bg-raised px-4 py-3">
        <h2 className="font-medium">{title}</h2>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function GuidePage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Guide</h1>
        <p className="max-w-2xl text-muted">
          Where your saves live, how to back them up, and exactly what this
          editor will and will not touch.
        </p>
      </header>

      {/* Backup ---------------------------------------------------------- */}
      <section className="card border-warning/40 p-5">
        <div className="flex gap-3">
          <span className="h-fit rounded-lg bg-warning/10 p-2 text-warning">
            <ShieldIcon className="size-5" />
          </span>
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Back up before you edit</h2>
            <p className="text-sm text-muted">
              Copy the <em>whole world folder</em> — not just{" "}
              <code>Level.sav</code> — somewhere outside the game directory, and
              close Palworld first so nothing is mid-write. If an edit goes
              wrong, deleting the edited folder and restoring the copy is the
              complete fix.
            </p>
            <ol className="space-y-1.5 text-sm text-muted">
              {[
                "Quit Palworld, or stop the dedicated server.",
                "Open the SaveGames folder for your platform (below).",
                "Copy the world folder and rename the copy, e.g. `<WorldID>-backup`.",
                "Only then load Level.sav into the editor.",
              ].map((step, index) => (
                <li key={step} className="flex gap-2">
                  <span className="font-mono text-xs text-accent">
                    {index + 1}.
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Locations ------------------------------------------------------- */}
      <Card title="Where Palworld keeps saves">
        <ul className="space-y-4">
          {LOCATIONS.map((location) => (
            <li key={location.platform}>
              <p className="text-sm font-medium">{location.platform}</p>
              <pre className="scroll-slim mt-1.5 overflow-x-auto rounded-lg bg-sunken p-3 text-xs">
                <code>{location.path}</code>
              </pre>
              <p className="mt-1.5 text-sm text-muted">{location.note}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-subtle">
          Paths shift between game updates and storefronts. If none of these
          match, search your drive for <code>Level.sav</code> — the folder
          containing it is the world folder.
        </p>
      </Card>

      {/* Files ----------------------------------------------------------- */}
      <Card title="What is in a world folder">
        <div className="scroll-slim overflow-x-auto">
          <table className="w-full min-w-120 text-left text-sm">
            <thead className="text-xs text-subtle">
              <tr>
                <th scope="col" className="pb-2 pr-4 font-medium">
                  File
                </th>
                <th scope="col" className="pb-2 font-medium">
                  Holds
                </th>
              </tr>
            </thead>
            <tbody>
              {WORLD_FILES.map((file) => (
                <tr key={file.name} className="border-t border-line">
                  <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-accent">
                    {file.name}
                  </td>
                  <td className="py-2 text-muted">{file.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Scope ----------------------------------------------------------- */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="What you can change">
          <ul className="space-y-2 text-sm">
            {SUPPORTED.map((item) => (
              <li key={item} className="flex gap-2">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
                <span className="text-muted">{item}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="What it will not do">
          <ul className="space-y-2 text-sm">
            {UNSUPPORTED.map((item) => (
              <li key={item} className="flex gap-2">
                <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                <span className="text-muted">{item}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Format ---------------------------------------------------------- */}
      <Card title="How the save format works">
        <div className="space-y-3 text-sm text-muted">
          <p>
            A Palworld <code>.sav</code> is a thin container around an Unreal
            Engine GVAS blob. Twelve bytes of header record the compressed and
            uncompressed sizes, a magic string, and a codec byte; the rest is
            the compressed payload.
          </p>
          <p>
            Saves written before game version 0.6 use <code>PlZ</code> with one
            or two zlib passes. From 0.6 onward the game writes <code>PlM</code>
            , compressed with Oodle Kraken. This editor reads both and always
            writes <code>PlZ</code> with a single zlib pass — Palworld loads
            that fine and upgrades the file itself on its next save.
          </p>
          <p>
            Inside the GVAS, the interesting parts hang off{" "}
            <code>worldSaveData</code>: <code>CharacterSaveParameterMap</code>{" "}
            holds every Pal and player, <code>ItemContainerSaveData</code> holds
            every inventory, and <code>GroupSaveDataMap</code> holds guilds.
            Several of those store their contents as nested byte arrays, which
            is why some entries show up as raw rather than as editable fields.
          </p>
          <p>
            A container only stores the slots it is actually using — its{" "}
            <code>SlotNum</code> is the capacity, and each stored slot carries
            its own in-game slot number. That is why emptying a slot deletes its
            entry rather than blanking it, and why adding an item appends a new
            one. Equipment is a special case: durability, ammo and passives live
            in a separate <code>DynamicItemSaveData</code> record, so adding a
            weapon or armour piece copies the record of one the world already
            holds.
          </p>
          <p>
            Parsing is done by{" "}
            <a
              href="https://github.com/trumank/uesave-rs"
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent underline"
            >
              uesave-rs
            </a>
            , with Palworld-specific type hints so the maps decode into real
            structs instead of opaque blobs.
          </p>
        </div>
        <Link href="/tools" className="btn btn-secondary mt-4">
          Inspect a container yourself
          <ArrowRightIcon className="size-4" />
        </Link>
      </Card>

      {/* Troubleshooting -------------------------------------------------- */}
      <Card title="Troubleshooting">
        <dl className="divide-y divide-line">
          {TROUBLESHOOTING.map((entry) => (
            <div key={entry.question} className="py-3 first:pt-0 last:pb-0">
              <dt className="text-sm font-medium">{entry.question}</dt>
              <dd className="mt-1 text-sm text-muted">{entry.answer}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <section className="card flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">Backup made?</h2>
          <p className="mt-1 text-sm text-muted">
            Then you are ready to load a world.
          </p>
        </div>
        <Link href="/editor" className="btn btn-primary">
          Open the editor
          <ArrowRightIcon className="size-4" />
        </Link>
      </section>
    </div>
  );
}
