import type { Metadata } from "next";
import { ActiveSkillsBrowser } from "@/components/wiki/skills-browser";

export const metadata: Metadata = {
  title: "Active skills",
  description:
    "Palworld active skills: element, power, range, cooldown and status effects, searchable by name or ID.",
};

export default function ActiveSkillsWikiPage() {
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Active skills</h1>
        <p className="text-sm text-muted">
          Combat skills, as the save stores them in EquipWaza.
        </p>
      </header>

      <ActiveSkillsBrowser />
    </>
  );
}
