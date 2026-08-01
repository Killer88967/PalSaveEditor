"use client";

import { useEffect, useState } from "react";
import {
  DetailHeader,
  Stat,
  WikiBrowser,
  WikiIcon,
} from "@/components/wiki-browser";
import {
  loadWikiData,
  type WikiElement,
  type WikiPal,
  type WikiWorkType,
} from "@/lib/wiki";

const SORTS = [
  {
    id: "dex",
    label: "Paldeck",
    compare: (a: WikiPal, b: WikiPal) =>
      (a.dexIndex ?? Infinity) - (b.dexIndex ?? Infinity) ||
      a.name.localeCompare(b.name),
  },
  {
    id: "name",
    label: "Name",
    compare: (a: WikiPal, b: WikiPal) => a.name.localeCompare(b.name),
  },
  {
    id: "hp",
    label: "HP",
    compare: (a: WikiPal, b: WikiPal) => b.scaling.hp - a.scaling.hp,
  },
  {
    id: "attack",
    label: "Attack",
    compare: (a: WikiPal, b: WikiPal) => b.scaling.attack - a.scaling.attack,
  },
];

export function PalsBrowser() {
  const [elements, setElements] = useState<WikiElement[]>([]);
  const [work, setWork] = useState<WikiWorkType[]>([]);

  useEffect(() => {
    void loadWikiData("elements").then(setElements).catch(() => {});
    void loadWikiData("work-suitability").then(setWork).catch(() => {});
  }, []);

  const elementOf = (id: string) => elements.find((entry) => entry.id === id);
  const workOf = (id: string) => work.find((entry) => entry.id === id);

  return (
      <WikiBrowser
        set="pals"
        searchPlaceholder="Search Pals by name or ID…"
        keyOf={(pal) => pal.id}
        matches={(pal, query) =>
          pal.name.toLowerCase().includes(query) ||
          pal.id.toLowerCase().includes(query)
        }
        filters={[
          ...elements.map((element) => ({
            id: element.id,
            label: element.name,
            icon: element.icon,
          })),
          { id: "boss", label: "Alpha / boss" },
          { id: "human", label: "Human" },
        ]}
        passesFilter={(pal, filter) => {
          if (filter === "boss") return pal.boss;
          if (filter === "human") return !pal.isPal;
          return pal.elements.includes(filter);
        }}
        sorts={SORTS}
        renderRow={(pal) => (
          <>
            <WikiIcon icon={pal.icon} alt="" className="size-8" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {pal.name}
              </span>
              <span className="block truncate font-mono text-[11px] text-subtle">
                {pal.id}
              </span>
            </span>
            <span className="flex shrink-0 gap-0.5">
              {pal.elements.map((element) => (
                <WikiIcon
                  key={element}
                  icon={elementOf(element)?.icon}
                  alt={element}
                  className="size-4"
                />
              ))}
            </span>
          </>
        )}
        emptyDetail="Select a Pal to see its stats."
        renderDetail={(pal) => (
          <div className="space-y-4">
            <DetailHeader
              icon={pal.icon}
              name={pal.name}
              id={pal.id}
              description={pal.description}
              badges={
                <>
                  {pal.dexIndex !== null && (
                    <span className="badge">#{pal.dexIndex}</span>
                  )}
                  {pal.elements.map((element) => {
                    const data = elementOf(element);
                    return (
                      <span
                        key={element}
                        className="badge"
                        style={data ? { color: data.color } : undefined}
                      >
                        <WikiIcon
                          icon={data?.icon}
                          alt=""
                          className="size-3.5"
                        />
                        {data?.name ?? element}
                      </span>
                    );
                  })}
                  {pal.boss && <span className="badge badge-warning">Boss</span>}
                  {!pal.isPal && <span className="badge">Human</span>}
                  {pal.nocturnal && <span className="badge">Nocturnal</span>}
                </>
              }
            />

            <dl className="grid grid-cols-3 gap-2">
              <Stat label="HP" value={pal.scaling.hp} />
              <Stat label="Attack" value={pal.scaling.attack} />
              <Stat label="Defence" value={pal.scaling.defense} />
            </dl>

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Rarity" value={pal.rarity} />
              <Stat label="Size" value={pal.size} />
              <Stat label="Genus" value={pal.genus} />
              <Stat label="Stamina" value={pal.stamina} />
              <Stat label="Food" value={pal.foodAmount} />
              <Stat label="Walk" value={pal.speeds.walk} />
              <Stat label="Run" value={pal.speeds.run} />
              <Stat label="Ride sprint" value={pal.speeds.rideSprint} />
            </dl>

            {Object.keys(pal.work).length > 0 && (
              <section>
                <h3 className="text-sm font-medium">Work suitability</h3>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(pal.work).map(([id, level]) => (
                    <li key={id} className="badge">
                      <WikiIcon
                        icon={workOf(id)?.icon}
                        alt=""
                        className="size-3.5"
                      />
                      {workOf(id)?.name ?? id}
                      <span className="text-accent">Lv {level}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {pal.skills.length > 0 && (
              <section>
                <h3 className="text-sm font-medium">Skills by level</h3>
                <ul className="mt-2 space-y-1">
                  {[...pal.skills]
                    .sort((a, b) => a.level - b.level)
                    .map((skill) => (
                      <li
                        key={`${skill.id}-${skill.level}`}
                        className="flex items-baseline gap-2 text-sm"
                      >
                        <span className="w-12 shrink-0 font-mono text-xs text-subtle">
                          Lv {skill.level}
                        </span>
                        <span className="font-mono text-xs text-accent">
                          {skill.id}
                        </span>
                      </li>
                    ))}
                </ul>
              </section>
            )}

            {pal.passives.length > 0 && (
              <section>
                <h3 className="text-sm font-medium">Innate passives</h3>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {pal.passives.map((passive) => (
                    <li key={passive} className="badge">
                      <span className="font-mono">{passive}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      />
  );
}
