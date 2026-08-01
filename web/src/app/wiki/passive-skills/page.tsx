import type { Metadata } from "next";
import { PassiveSkillsBrowser } from "@/components/wiki/skills-browser";

export const metadata: Metadata = {
  title: "Passive skills",
  description:
    "Palworld passive skills: rank, effects and which gear or Pals they can roll on.",
};

export default function PassiveSkillsWikiPage() {
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Passive skills</h1>
        <p className="text-sm text-muted">Passive traits, as the save stores them in PassiveSkillList.</p>
      </header>

      <PassiveSkillsBrowser />
    </>
  );
}
