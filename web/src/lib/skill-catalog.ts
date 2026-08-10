"use client";

import { useEffect, useState } from "react";
import { ELEMENT_COLORS } from "@/lib/pal-catalog";
import type { WikiActiveSkill, WikiPassiveSkill } from "@/lib/wiki";

export interface SkillOption {
  value: string; // exact stored string: "EPalWazaID::X" for moves, bare id for passives
  name: string;
  sub?: string;
  color?: string;
}

let activeCache: SkillOption[] | null = null;
let passiveCache: SkillOption[] | null = null;
let pending: Promise<void> | null = null;

function load(): Promise<void> {
  if (activeCache && passiveCache) return Promise.resolve();
  if (!pending) {
    pending = Promise.all([
      fetch("/wiki/data/active-skills.json").then((r) => r.json()),
      fetch("/wiki/data/passive-skills.json").then((r) => r.json()),
    ])
      .then(([active, passive]: [WikiActiveSkill[], WikiPassiveSkill[]]) => {
        activeCache = active
          .map((s) => ({
            value: `EPalWazaID::${s.id}`,
            name: s.name,
            sub: [s.element, s.type, s.power ? `${s.power} pow` : null]
              .filter(Boolean)
              .join(" · "),
            color: s.element ? ELEMENT_COLORS[s.element] : undefined,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        passiveCache = passive
          .map((s) => ({ value: s.id, name: s.name, sub: s.description }))
          .sort((a, b) => a.name.localeCompare(b.name));
      })
      .catch(() => {
        activeCache = [];
        passiveCache = [];
      });
  }
  return pending;
}

export function useSkillCatalog() {
  const [state, setState] = useState<{
    active: SkillOption[];
    passive: SkillOption[];
  }>({
    active: [],
    passive: [],
  });
  useEffect(() => {
    let ok = true;
    void load().then(
      () =>
        ok &&
        setState({ active: activeCache ?? [], passive: passiveCache ?? [] }),
    );
    return () => {
      ok = false;
    };
  }, []);
  return state;
}
