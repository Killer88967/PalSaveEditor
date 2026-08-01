import type { Metadata } from "next";
import Link from "next/link";
import { Note, OnThisPage, Section, Steps, WikiHeader } from "@/components/wiki-ui";

export const metadata: Metadata = {
  title: "Usage",
  description:
    "How to load a Palworld world into PalSaveEditor, edit Pals, players and inventories, and export a save the game will load.",
};

const SECTIONS = [
  { id: "tldr", title: "tl;dr" },
  { id: "loading", title: "Loading a world" },
  { id: "pals", title: "Editing Pals" },
  { id: "players", title: "Editing players" },
  { id: "inventories", title: "Editing inventories" },
  { id: "raw", title: "The raw property tree" },
  { id: "export", title: "Exporting and putting it back" },
  { id: "convert", title: "Converting .sav ⇄ .gvas" },
] as const;

export default function WikiUsagePage() {
  return (
    <>
      <WikiHeader
        title="Usage"
        lead="From a copied world folder to an edited save the game loads, in the order you will actually do it."
      />

      <OnThisPage sections={SECTIONS} />

      <Section id="tldr" title="tl;dr">
        <Steps
          items={[
            <>
              Quit Palworld (or stop the dedicated server) and copy your whole
              world folder somewhere safe.
            </>,
            <>
              Open the <Link href="/editor" className="text-accent underline">editor</Link>{" "}
              and drop in <code>Level.sav</code> together with the contents of
              the world&apos;s <code>Players</code> folder.
            </>,
            <>
              Use the Overview, Pals, Players, Inventories and Raw tree tabs.
              Every change is written into the session as you make it.
            </>,
            <>
              Hit <strong>Export</strong>. The file is re-parsed before it
              downloads, so a bad edit fails here rather than in-game.
            </>,
            <>
              Rename the download to <code>Level.sav</code> and drop it into
              your world folder, replacing the original.
            </>,
          ]}
        />
        <Note tone="warning">
          <p>
            The backup in step 1 is the only thing that makes any of the rest
            reversible. <Link href="/guide" className="text-accent underline">The guide</Link>{" "}
            has the exact folder for your platform.
          </p>
        </Note>
      </Section>

      <Section id="loading" title="Loading a world">
        <p>
          The editor keys everything off <code>Level.sav</code> — the world
          file that holds every character, base and container. Select it
          together with the individual <code>Players/&lt;uid&gt;.sav</code>{" "}
          files in one drop; the player files are what connect a player to
          their inventory containers.
        </p>
        <ul className="space-y-1.5">
          <li>
            <strong className="font-medium text-foreground">Level.sav only</strong>{" "}
            — Overview, Pals, Players and the raw tree all work.
          </li>
          <li>
            <strong className="font-medium text-foreground">
              Level.sav + Players/
            </strong>{" "}
            — adds the Inventories tab.
          </li>
        </ul>
        <p>
          The upload becomes a <em>session</em>: the parsed save is held in
          memory by the Rust API, addressed by a session ID, and carries a
          revision number that every edit increments. Nothing is written to
          disk until you export.
        </p>
        <p>
          Uploads are capped at 512 MiB, and a decompressed world at 2 GiB
          (raise it with <code>PALSAVE_MAX_DECOMPRESSED_SIZE</code>). Game Pass
          saves use an obfuscated container layout with no <code>.sav</code>{" "}
          extension and cannot be read.
        </p>
      </Section>

      <Section id="pals" title="Editing Pals">
        <Steps
          items={[
            <>
              Open the <strong>Pals</strong> tab and narrow the list: search by
              species, nickname or instance ID, or filter by level, gender,
              species and owner.
            </>,
            <>
              Select a row, then press <strong>Edit</strong>. Only the fields
              that entry actually contains are shown — the editor never invents
              a property to make a form look complete.
            </>,
            <>
              Change level (1–255), gender, souls (<code>Rank_HP</code>,{" "}
              <code>Rank_Attack</code>, <code>Rank_Defence</code>,{" "}
              <code>Rank_CraftSpeed</code>), IVs (<code>Talent_*</code>),
              nickname, and the passive and active skill lists.
            </>,
            <>
              Save. The row updates in place and the session revision moves on.
            </>,
          ]}
        />
        <p>
          Skill lists take internal IDs, not display names — the{" "}
          <Link href="/wiki/active-skills" className="text-accent underline">
            active
          </Link>{" "}
          and{" "}
          <Link href="/wiki/passive-skills" className="text-accent underline">
            passive
          </Link>{" "}
          skill pages list every one of them.
        </p>
        <Note>
          <p>
            Star rank is shown but not editable. It is stored outside the
            per-Pal parameters this editor rewrites, so offering a control that
            silently did nothing would be worse than leaving it read-only.
          </p>
        </Note>
      </Section>

      <Section id="players" title="Editing players">
        <p>
          Players live in the same character map as Pals but carry different
          fields, so they have their own tab: a <code>Level</code> byte, an{" "}
          <code>Exp</code> total, and two arrays of status points.
        </p>
        <ul className="space-y-1.5">
          <li>
            <strong className="font-medium text-foreground">Level</strong> — no
            game-balance cap is imposed. The limit is what the field can store,
            which for a byte is 255.
          </li>
          <li>
            <strong className="font-medium text-foreground">Experience</strong>{" "}
            — stored separately from level, so raising one leaves the other
            alone. Set both if you want the next level-up to behave.
          </li>
          <li>
            <strong className="font-medium text-foreground">
              Status points
            </strong>{" "}
            — HP, stamina, attack, carry weight, capture power, work speed and
            move speed, each capped at 255 like Pal souls. A second{" "}
            <em>bonus</em> allocation is edited the same way.
          </li>
        </ul>
        <Note>
          <p>
            Maximum HP, stamina and carry weight are not stored in the save at
            all — the game derives them from level and status points when it
            loads. That is why raising a stat here shows up in-game rather than
            in the editor.
          </p>
        </Note>
      </Section>

      <Section id="inventories" title="Editing inventories">
        <p>
          The Inventories tab walks a player&apos;s personal containers:
          backpack, key items, weapon loadout, armour, food slots and drop
          slots. Pick a player, then work container by container.
        </p>
        <Steps
          items={[
            <>
              <strong>Edit</strong> a stored slot to change its item ID or stack
              quantity.
            </>,
            <>
              <strong>Add item</strong> writes a new stack into any free slot.
              The picker suggests IDs the uploaded world already contains, and
              the full catalogue is on the{" "}
              <Link href="/wiki/items" className="text-accent underline">
                items page
              </Link>
              ; any other ID is written faithfully, but the game ignores one it
              does not know.
            </>,
            <>
              <strong>Remove</strong> drops the slot entry, which is exactly how
              a save records an empty slot.
            </>,
          ]}
        />
        <p>
          A container only stores the slots it is using, so a header reading
          &ldquo;8 / 230 slots&rdquo; means eight entries exist, not that slots
          9 onwards are missing.
        </p>
        <Note>
          <p>
            Weapons and armour keep their durability, ammo and passives in a
            separate <code>DynamicItemSaveData</code> record. Adding gear copies
            the record of one the world already holds; if there is no such item
            anywhere in the save, the editor says so rather than writing a
            broken one.
          </p>
        </Note>
      </Section>

      <Section id="raw" title="The raw property tree">
        <p>
          The Raw tree tab pages through every property the parser understands,
          with types, child counts and byte lengths. Any scalar can be edited
          there, which covers everything the purpose-built tabs do not.
        </p>
        <p>
          Rows the parser could not decode are shown as raw bytes and left
          alone. Editing a Pal or an inventory slot elsewhere in the app jumps
          you here with the matching path highlighted.
        </p>
      </Section>

      <Section id="export" title="Exporting and putting it back">
        <p>
          Export re-serialises the whole tree, then parses the result again
          before it reaches you. If that check fails, nothing downloads — the
          error points at the writer rather than at your save.
        </p>
        <Steps
          items={[
            <>
              Download the export. It arrives as{" "}
              <code>Level.roundtrip.sav</code>.
            </>,
            <>
              Rename it to <code>Level.sav</code>.
            </>,
            <>
              Put it in the world folder, replacing the original — with the game
              closed and the server stopped.
            </>,
            <>Launch the game and check the world loads before playing on.</>,
          ]}
        />
        <p>
          Exports are always written as single-pass <code>PlZ</code> zlib, which
          Palworld loads regardless of which format it wrote, and re-saves in
          its own format afterwards.
        </p>
      </Section>

      <Section id="convert" title="Converting .sav ⇄ .gvas">
        <p>
          The{" "}
          <Link href="/tools" className="text-accent underline">
            Convert
          </Link>{" "}
          page strips the Palworld container off a <code>.sav</code> to give you
          the raw Unreal GVAS payload, and packs GVAS back into a loadable{" "}
          <code>.sav</code>. It is stateless — no session, no upload limit
          beyond the request size — and useful for diffing two saves or feeding
          another tool.
        </p>
      </Section>
    </>
  );
}
