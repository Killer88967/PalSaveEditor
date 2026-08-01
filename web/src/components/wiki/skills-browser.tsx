"use client";

import { useEffect, useState } from "react";
import {
  DetailHeader,
  Stat,
  WikiBrowser,
  WikiIcon,
} from "@/components/wiki-browser";
import { humanizeId } from "@/lib/format";
import {
  loadWikiData,
  type WikiActiveSkill,
  type WikiEffect,
  type WikiElement,
  type WikiPassiveSkill,
} from "@/lib/wiki";

function Effects({ effects }: { effects: WikiEffect[] }) {
  if (effects.length === 0) return null;

  return (
    <section>
      <h3 className="text-sm font-medium">Effects</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {effects.map((effect, index) => (
          <li key={index} className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-xs text-accent">{effect.type}</span>
            <span className="tabular-nums text-muted">{effect.value}</span>
            {effect.target && (
              <span className="text-xs text-subtle">
                {humanizeId(effect.target)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ActiveSkillsBrowser() {
  const [elements, setElements] = useState<WikiElement[]>([]);

  useEffect(() => {
    void loadWikiData("elements").then(setElements).catch(() => {});
  }, []);

  const elementOf = (id: string | null) =>
    elements.find((entry) => entry.id === id);

  return (
    <WikiBrowser
      set="active-skills"
      searchPlaceholder="Search active skills…"
      keyOf={(skill) => skill.id}
      matches={(skill, query) =>
        skill.name.toLowerCase().includes(query) ||
        skill.id.toLowerCase().includes(query)
      }
      filters={elements.map((element) => ({
        id: element.id,
        label: element.name,
        icon: element.icon,
      }))}
      passesFilter={(skill, filter) => skill.element === filter}
      sorts={[
        {
          id: "name",
          label: "Name",
          compare: (a: WikiActiveSkill, b: WikiActiveSkill) =>
            a.name.localeCompare(b.name),
        },
        {
          id: "power",
          label: "Power",
          compare: (a: WikiActiveSkill, b: WikiActiveSkill) =>
            b.power - a.power,
        },
        {
          id: "cooldown",
          label: "Cooldown",
          compare: (a: WikiActiveSkill, b: WikiActiveSkill) =>
            a.cooldown - b.cooldown,
        },
      ]}
      renderRow={(skill) => (
        <>
          <WikiIcon
            icon={elementOf(skill.element)?.icon}
            alt=""
            className="size-5"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {skill.name}
            </span>
            <span className="block truncate font-mono text-[11px] text-subtle">
              {skill.id}
            </span>
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-subtle">
            {skill.power}
          </span>
        </>
      )}
      emptyDetail="Select a skill to see its numbers."
      renderDetail={(skill) => {
        const element = elementOf(skill.element);

        return (
          <div className="space-y-4">
            <DetailHeader
              icon={element?.icon}
              name={skill.name}
              id={skill.id}
              description={skill.description}
              badges={
                <>
                  {element && (
                    <span className="badge" style={{ color: element.color }}>
                      {element.name}
                    </span>
                  )}
                  {skill.type && (
                    <span className="badge">{humanizeId(skill.type)}</span>
                  )}
                </>
              }
            />

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Power" value={skill.power} />
              <Stat label="Cooldown" value={`${skill.cooldown}s`} />
              <Stat label="Min range" value={skill.minRange} />
              <Stat label="Max range" value={skill.maxRange} />
            </dl>

            <Effects effects={skill.effects} />

            <p className="text-xs text-subtle">
              The Pal editor writes active skills as this ID in{" "}
              <code>EquipWaza</code>.
            </p>
          </div>
        );
      }}
    />
  );
}

export function PassiveSkillsBrowser() {
  return (
    <WikiBrowser
      set="passive-skills"
      searchPlaceholder="Search passive skills…"
      keyOf={(skill) => skill.id}
      matches={(skill, query) =>
        skill.name.toLowerCase().includes(query) ||
        skill.id.toLowerCase().includes(query)
      }
      filters={[
        { id: "pal", label: "Pals" },
        { id: "weapon", label: "Weapons" },
        { id: "armor", label: "Armour" },
        { id: "accessory", label: "Accessories" },
      ]}
      passesFilter={(skill, filter) => {
        const attaches = skill.attachesTo.join(" ").toLowerCase();
        if (filter === "pal") return attaches.includes("pal");
        if (filter === "weapon") return attaches.includes("weapon");
        if (filter === "armor") return attaches.includes("armour");
        return attaches.includes("accessor");
      }}
      sorts={[
        {
          id: "name",
          label: "Name",
          compare: (a: WikiPassiveSkill, b: WikiPassiveSkill) =>
            a.name.localeCompare(b.name),
        },
        {
          id: "rank",
          label: "Rank",
          compare: (a: WikiPassiveSkill, b: WikiPassiveSkill) =>
            b.rank - a.rank || a.name.localeCompare(b.name),
        },
      ]}
      renderRow={(skill) => (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {skill.name}
            </span>
            <span className="block truncate font-mono text-[11px] text-subtle">
              {skill.id}
            </span>
          </span>
          <span
            className={`shrink-0 text-[11px] tabular-nums ${
              skill.rank < 0 ? "text-danger" : "text-subtle"
            }`}
          >
            {skill.rank > 0 ? `+${skill.rank}` : skill.rank}
          </span>
        </>
      )}
      emptyDetail="Select a passive to see what it does."
      renderDetail={(skill) => (
        <div className="space-y-4">
          <DetailHeader
            name={skill.name}
            id={skill.id}
            description={skill.description}
            badges={
              <>
                <span
                  className={`badge ${skill.rank < 0 ? "badge-danger" : "badge-accent"}`}
                >
                  Rank {skill.rank}
                </span>
                {skill.attachesTo.map((target) => (
                  <span key={target} className="badge">
                    {target}
                  </span>
                ))}
              </>
            }
          />

          <Effects effects={skill.effects} />

          <p className="text-xs text-subtle">
            The Pal editor writes passives as this ID in{" "}
            <code>PassiveSkillList</code>.
          </p>
        </div>
      )}
    />
  );
}
