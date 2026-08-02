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
  type WikiBuilding,
  type WikiPal,
  type WikiTechnology,
} from "@/lib/wiki";

/** Elements and work types are short lists, so both show every Pal involved. */
export function ElementsBrowser() {
  const [pals, setPals] = useState<WikiPal[]>([]);

  useEffect(() => {
    void loadWikiData("pals")
      .then(setPals)
      .catch(() => {});
  }, []);

  return (
    <WikiBrowser
      set="elements"
      searchPlaceholder="Search elements…"
      keyOfAction={(element) => element.id}
      matchesAction={(element, query) =>
        element.name.toLowerCase().includes(query)
      }
      renderRowAction={(element) => (
        <>
          <WikiIcon icon={element.icon} alt="" className="size-5" />
          <span className="flex-1 text-sm font-medium">{element.name}</span>
          <span
            aria-hidden="true"
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: element.color }}
          />
        </>
      )}
      emptyDetail="Select an element."
      renderDetailAction={(element) => {
        const members = pals
          .filter((pal) => pal.isPal && pal.elements.includes(element.id))
          .sort((a, b) => a.name.localeCompare(b.name));

        return (
          <div className="space-y-4">
            <DetailHeader
              icon={element.icon}
              name={element.name}
              id={element.id}
              badges={
                <span className="badge" style={{ color: element.color }}>
                  {element.color}
                </span>
              }
            />

            <section>
              <h3 className="text-sm font-medium">
                Pals of this element{" "}
                <span className="text-subtle">({members.length})</span>
              </h3>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {members.map((pal) => (
                  <li
                    key={pal.id}
                    className="flex items-center gap-2 text-sm text-muted"
                  >
                    <WikiIcon icon={pal.icon} alt="" className="size-6" />
                    <span className="truncate">{pal.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        );
      }}
    />
  );
}

export function WorkSuitabilityBrowser() {
  const [pals, setPals] = useState<WikiPal[]>([]);

  useEffect(() => {
    void loadWikiData("pals")
      .then(setPals)
      .catch(() => {});
  }, []);

  const iconOf = (id: string) => pals.find((pal) => pal.id === id)?.icon;

  return (
    <WikiBrowser
      set="work-suitability"
      searchPlaceholder="Search work types…"
      keyOfAction={(work) => work.id}
      matchesAction={(work, query) =>
        work.name.toLowerCase().includes(query) ||
        work.id.toLowerCase().includes(query)
      }
      renderRowAction={(work) => (
        <>
          <WikiIcon icon={work.icon} alt="" className="size-5" />
          <span className="flex-1 text-sm font-medium">{work.name}</span>
          <span className="shrink-0 text-[11px] text-subtle">
            {work.pals.length}
          </span>
        </>
      )}
      emptyDetail="Select a work type."
      renderDetailAction={(work) => (
        <div className="space-y-4">
          <DetailHeader
            icon={work.icon}
            name={work.name}
            id={work.id}
            description={work.description}
            badges={
              <span className="badge badge-accent">
                {work.pals.length} Pals
              </span>
            }
          />

          <section>
            <h3 className="text-sm font-medium">Best workers first</h3>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {work.pals.map((pal) => (
                <li key={pal.id} className="flex items-center gap-2 text-sm">
                  <WikiIcon icon={iconOf(pal.id)} alt="" className="size-6" />
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {pal.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-accent">
                    Lv {pal.level}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    />
  );
}

export function TechnologiesBrowser() {
  return (
    <WikiBrowser
      set="technologies"
      searchPlaceholder="Search technologies…"
      keyOfAction={(tech) => tech.id}
      matchesAction={(tech, query) =>
        tech.name.toLowerCase().includes(query) ||
        tech.id.toLowerCase().includes(query)
      }
      filters={[
        { id: "boss", label: "Ancient (boss)" },
        { id: "normal", label: "Standard" },
      ]}
      passesFilterAction={(tech, filter) =>
        filter === "boss" ? tech.boss : !tech.boss
      }
      sorts={[
        {
          id: "level",
          label: "Unlock level",
          compare: (a: WikiTechnology, b: WikiTechnology) =>
            a.levelCap - b.levelCap || a.name.localeCompare(b.name),
        },
        {
          id: "name",
          label: "Name",
          compare: (a: WikiTechnology, b: WikiTechnology) =>
            a.name.localeCompare(b.name),
        },
        {
          id: "cost",
          label: "Cost",
          compare: (a: WikiTechnology, b: WikiTechnology) => b.cost - a.cost,
        },
      ]}
      renderRowAction={(tech) => (
        <>
          <WikiIcon icon={tech.icon} alt="" className="size-7" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {tech.name}
            </span>
            <span className="block truncate font-mono text-[11px] text-subtle">
              {tech.id}
            </span>
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-subtle">
            Lv {tech.levelCap}
          </span>
        </>
      )}
      emptyDetail="Select a technology."
      renderDetailAction={(tech) => (
        <div className="space-y-4">
          <DetailHeader
            icon={tech.icon}
            name={tech.name}
            id={tech.id}
            description={tech.description}
            badges={
              <>
                <span className="badge badge-accent">
                  Level {tech.levelCap}
                </span>
                <span className="badge">Tier {tech.tier}</span>
                {tech.boss && (
                  <span className="badge badge-warning">Ancient</span>
                )}
              </>
            }
          />

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Point cost" value={tech.cost} />
            <Stat label="Unlock level" value={tech.levelCap} />
            <Stat
              label="Requires"
              value={tech.requires ? humanizeId(tech.requires) : "Nothing"}
            />
          </dl>

          {[
            ["Unlocks items", tech.unlocksItems],
            ["Unlocks buildings", tech.unlocksBuildings],
          ]
            .filter(([, list]) => (list as string[]).length > 0)
            .map(([label, list]) => (
              <section key={label as string}>
                <h3 className="text-sm font-medium">{label as string}</h3>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {(list as string[]).map((entry) => (
                    <li key={entry} className="badge">
                      <span className="font-mono">{entry}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    />
  );
}

export function BuildingsBrowser() {
  return (
    <WikiBrowser
      set="buildings"
      searchPlaceholder="Search buildings…"
      keyOfAction={(building) => building.id}
      matchesAction={(building, query) =>
        building.name.toLowerCase().includes(query) ||
        building.id.toLowerCase().includes(query)
      }
      filters={[
        { id: "Pal", label: "Pal" },
        { id: "Production", label: "Production" },
        { id: "Infrastructure", label: "Infrastructure" },
        { id: "Furniture", label: "Furniture" },
        { id: "Defense", label: "Defence" },
        { id: "Foundation", label: "Foundation" },
      ]}
      passesFilterAction={(building, filter) => building.typeA === filter}
      sorts={[
        {
          id: "name",
          label: "Name",
          compare: (a: WikiBuilding, b: WikiBuilding) =>
            a.name.localeCompare(b.name),
        },
        {
          id: "hp",
          label: "Durability",
          compare: (a: WikiBuilding, b: WikiBuilding) => b.hp - a.hp,
        },
      ]}
      renderRowAction={(building) => (
        <>
          <WikiIcon icon={building.icon} alt="" className="size-7" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {building.name}
            </span>
            <span className="block truncate font-mono text-[11px] text-subtle">
              {building.id}
            </span>
          </span>
        </>
      )}
      emptyDetail="Select a building."
      renderDetailAction={(building) => (
        <div className="space-y-4">
          <DetailHeader
            icon={building.icon}
            name={building.name}
            id={building.id}
            description={building.description}
            badges={
              <>
                {building.typeA && (
                  <span className="badge">{humanizeId(building.typeA)}</span>
                )}
                {building.typeB && (
                  <span className="badge">{humanizeId(building.typeB)}</span>
                )}
                {building.energy && (
                  <span className="badge badge-warning">
                    Needs {humanizeId(building.energy)}
                  </span>
                )}
              </>
            }
          />

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Durability" value={building.hp.toLocaleString()} />
            <Stat label="Defence" value={building.defense} />
            <Stat label="Rank" value={building.rank} />
          </dl>

          {building.materials.length > 0 && (
            <section>
              <h3 className="text-sm font-medium">Materials</h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {building.materials.map((material) => (
                  <li key={material.id} className="badge">
                    <span className="font-mono">{material.id}</span>
                    <span className="text-accent">× {material.count}</span>
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
