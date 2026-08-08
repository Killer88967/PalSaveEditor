"use client";

import { useEffect, useState } from "react";

export interface Species {
  characterId: string;
  name: string;
  icon: string;
  dex: number;
  elements: string[];
  rarity: number;
}

/** Palworld's nine element identities. */
export const ELEMENT_COLORS: Record<string, string> = {
  Normal: "#b9b6ac",
  Fire: "#f0733b",
  Water: "#3aa6e6",
  Leaf: "#5cb85c",
  Electricity: "#e6c53a",
  Ice: "#79d0e0",
  Earth: "#c19a5b",
  Dark: "#9b6bd6",
  Dragon: "#7b8cde",
};

export const stripPrefix = (id: string) => id.replace(/^(BOSS_|GYM_)/i, "");
export const isAlpha = (id?: string | null) => !!id && /^BOSS_/i.test(id);

let cache: Map<string, Species> | null = null;
let pending: Promise<Map<string, Species>> | null = null;

export function loadPalCatalog(): Promise<Map<string, Species>> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = fetch("/wiki/data/species.json")
      .then((r) => r.json() as Promise<Species[]>)
      .then(
        (list) =>
          (cache = new Map(list.map((s) => [s.characterId.toLowerCase(), s]))),
      )
      .catch(() => new Map<string, Species>());
  }
  return pending;
}

export function lookupSpecies(
  catalog: Map<string, Species>,
  characterId?: string | null,
) {
  return characterId
    ? catalog.get(stripPrefix(characterId).toLowerCase())
    : undefined;
}

export function usePalCatalog(): Map<string, Species> {
  const [catalog, setCatalog] = useState<Map<string, Species>>(new Map());
  useEffect(() => {
    let active = true;
    void loadPalCatalog().then((c) => active && setCatalog(c));
    return () => {
      active = false;
    };
  }, []);
  return catalog;
}