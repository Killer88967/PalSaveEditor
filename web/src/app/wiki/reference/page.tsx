import type { Metadata } from "next";
import {
  DataTable,
  Note,
  OnThisPage,
  Section,
  WikiHeader,
} from "@/components/wiki-ui";

export const metadata: Metadata = {
  title: "Reference",
  description:
    "The Palworld .sav container, what lives under worldSaveData, how inventory slots and player status points are stored, the editor's limits, and the HTTP API.",
};

const SECTIONS = [
  { id: "container", title: "The .sav container" },
  { id: "world", title: "Inside worldSaveData" },
  { id: "characters", title: "Character rows" },
  { id: "status", title: "Player status names" },
  { id: "containers", title: "Inventory containers" },
  { id: "slots", title: "How a slot is stored" },
  { id: "limits", title: "Editing limits" },
  { id: "api", title: "HTTP API" },
] as const;

export default function WikiReferencePage() {
  return (
    <>
      <WikiHeader
        title="Reference"
        lead="What the save format actually contains, and what this editor does with it. Everything here was read out of real saves."
      />

      <OnThisPage sections={SECTIONS} />

      <Section id="container" title="The .sav container">
        <p>
          A Palworld <code>.sav</code> is twelve bytes of header wrapped around
          a compressed Unreal GVAS blob.
        </p>
        <DataTable
          columns={["Offset", "Size", "Field"]}
          mono={[0, 1]}
          rows={[
            ["0", "4", "Uncompressed payload size, u32 little-endian"],
            ["4", "4", "Compressed payload size, u32 little-endian"],
            ["8", "3", "Magic: PlZ (zlib) or PlM (Oodle Kraken)"],
            ["11", "1", "Codec byte, selecting one or two compression passes"],
            ["12", "…", "The compressed payload itself"],
          ]}
        />
        <p>
          Saves written before game version 0.6 use <code>PlZ</code>; from 0.6
          onward the game writes <code>PlM</code>. This editor reads both and
          always writes single-pass <code>PlZ</code>.
        </p>
      </Section>

      <Section id="world" title="Inside worldSaveData">
        <DataTable
          columns={["Collection", "Holds"]}
          mono={[0]}
          rows={[
            [
              "CharacterSaveParameterMap",
              "Every Pal and player, one map entry each. Each value's RawData is a nested property tree.",
            ],
            [
              "ItemContainerSaveData",
              "Every inventory in the world, keyed by container ID, storing only its occupied slots.",
            ],
            [
              "DynamicItemSaveData",
              "Per-instance state for gear: durability, remaining ammo and rolled passives.",
            ],
            [
              "GroupSaveDataMap",
              "Guilds and their membership. Read by the overview, not editable here.",
            ],
          ]}
        />
        <p>
          The Overview tab sizes every collection in the file, including the
          ones above and the map, foliage and base data this editor leaves
          alone.
        </p>
      </Section>

      <Section id="characters" title="Character rows">
        <p>
          Pals and players share the same map but carry different fields, which
          is why they have separate tabs.
        </p>
        <DataTable
          columns={["Field", "On", "Meaning"]}
          mono={[0]}
          rows={[
            ["CharacterID", "Pals", "Species ID, e.g. Anubis or BOSS_Anubis"],
            ["Level", "Both", "Stored as a byte, so 255 is the format's ceiling"],
            ["Exp", "Players", "Total experience, Int64"],
            ["Rank", "Pals", "Star rank — read by the editor, not written"],
            ["Rank_HP / _Attack / _Defence / _CraftSpeed", "Pals", "Souls, 0–255 each"],
            ["Talent_HP / _Melee / _Shot / _Defense", "Pals", "IVs, 0–255 each"],
            ["PassiveSkillList", "Pals", "Passive skill IDs"],
            ["EquipWaza", "Pals", "Equipped active skill IDs"],
            ["GotStatusPointList", "Players", "Spent status points, by name"],
            ["GotExStatusPointList", "Players", "The separate bonus allocation"],
            ["NickName", "Both", "Display name"],
          ]}
        />
      </Section>

      <Section id="status" title="Player status names">
        <p>
          Palworld writes these names in Japanese whatever language the client
          runs in, so the editor matches them verbatim and only translates them
          for display. A player only has the entries their own save contains —
          the lists differ between characters.
        </p>
        <DataTable
          columns={["Stored name", "Shown as"]}
          mono={[0]}
          rows={[
            ["最大HP", "Max HP"],
            ["最大SP", "Max stamina"],
            ["攻撃力", "Attack"],
            ["防御力", "Defence"],
            ["所持重量", "Carry weight"],
            ["捕獲率", "Capture power"],
            ["作業速度", "Work speed"],
            ["移動速度アップ", "Move speed"],
          ]}
        />
      </Section>

      <Section id="containers" title="Inventory containers">
        <p>
          A player&apos;s <code>.sav</code> points at the containers that belong
          to them; the containers themselves live in the world file.
        </p>
        <DataTable
          columns={["Container ID field", "Shown as"]}
          mono={[0]}
          rows={[
            ["CommonContainerId", "Backpack"],
            ["DropSlotContainerId", "Drop slots"],
            ["EssentialContainerId", "Key items"],
            ["WeaponLoadOutContainerId", "Weapon loadout"],
            ["PlayerEquipArmorContainerId", "Armour"],
            ["FoodEquipContainerId", "Food slots"],
          ]}
        />
      </Section>

      <Section id="slots" title="How a slot is stored">
        <p>
          A container&apos;s <code>SlotNum</code> is its capacity, but only
          occupied slots are stored — each one carrying its own in-game slot
          number. Position in the array means nothing.
        </p>
        <DataTable
          columns={["Bytes", "Field"]}
          mono={[0]}
          rows={[
            ["0–3", "Slot index, i32 — where the item sits in-game"],
            ["4–7", "Stack count, i32"],
            ["8…", "Static item ID, as a length-prefixed string"],
            ["+16", "Created-world ID, referencing DynamicItemSaveData"],
            ["+16", "Local ID, the instance's own identity"],
            ["…", "Trailing bytes, usually 20, preserved as found"],
          ]}
        />
        <Note>
          <p>
            Both IDs are zero for plain stackable items. When they are set, the
            slot points at a <code>DynamicItemSaveData</code> record — which is
            why adding a weapon copies an existing one rather than inventing
            durability from nothing.
          </p>
        </Note>
      </Section>

      <Section id="limits" title="Editing limits">
        <DataTable
          columns={["Field", "Accepted range", "Why"]}
          rows={[
            ["Pal level", "1 – 255", "Byte storage"],
            ["Pal souls and IVs", "0 – 255", "Byte storage"],
            ["Player level", "1 – whatever the field holds (255 for a byte)", "No balance cap is imposed"],
            ["Player experience", "0 or greater", "Int64"],
            ["Status points", "0 – 255", "Matches the Pal soul cap"],
            ["Stack quantity", "Any i32 the slot can hold", "The game clamps display, not storage"],
            ["Nickname", "Up to 64 characters", "Editor guard"],
            ["Skill lists", "Up to 64 IDs, each ≤ 128 characters", "Editor guard"],
          ]}
        />
        <p>
          Anything absent from an entry is refused rather than created, so a
          partial row stays partial and the save keeps its original shape.
        </p>
      </Section>

      <Section id="api" title="HTTP API">
        <p>
          The browser reaches the Rust API through the Next.js rewrite at{" "}
          <code>/api/rust/*</code>. Every mutation takes an{" "}
          <code>expectedRevision</code> and answers <code>409</code> with the
          current revision if the session moved on without it.
        </p>
        <DataTable
          columns={["Method", "Route", "Purpose"]}
          mono={[0, 1]}
          rows={[
            ["POST", "/sessions", "Parse an upload into a session"],
            ["GET", "/sessions/{id}/overview", "Dashboard statistics"],
            ["GET", "/sessions/{id}/pals", "Filtered, paged character index"],
            ["PATCH", "/sessions/{id}/pals/{palId}", "Update supported Pal fields"],
            ["GET", "/sessions/{id}/player-stats", "Player level, experience and status points"],
            ["PATCH", "/sessions/{id}/player-stats/{uid}", "Update player level and status points"],
            ["GET", "/sessions/{id}/players/{uid}/inventory", "A player's containers and slots"],
            ["POST", "/sessions/{id}/players/{uid}/inventory/{containerId}/slots", "Add an item to a free slot"],
            ["PATCH", "…/slots/{index}", "Write one slot"],
            ["DELETE", "…/slots/{index}", "Empty a slot by dropping its entry"],
            ["GET", "/sessions/{id}/items", "Item IDs present in this world"],
            ["PATCH", "/sessions/{id}/scalar", "Write one scalar anywhere in the tree"],
            ["GET", "/sessions/{id}/export?validate=true", "Recompiled .sav, re-parsed first"],
            ["GET", "/sessions/{id}/gvas", "Uncompressed GVAS for the current tree"],
            ["POST", "/convert/decompile", ".sav → raw GVAS, stateless"],
            ["POST", "/convert/recompile", "Raw GVAS → .sav, stateless"],
          ]}
        />
        <p>
          Downloads carry <code>x-palsave-revision</code>,{" "}
          <code>x-palsave-dirty</code>, <code>x-palsave-compression</code> and{" "}
          <code>x-palsave-decompressed-size</code>; exports add{" "}
          <code>x-palsave-validated</code>.
        </p>
      </Section>
    </>
  );
}
