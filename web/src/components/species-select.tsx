"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WikiIcon } from "@/components/wiki-browser";
import { ELEMENT_COLORS, type Species } from "@/lib/pal-catalog";
import { humanizeId } from "@/lib/format";

export function SpeciesSelect({
  value,
  options,
  onChangeAction,
}: {
  value: string;
  options: Species[];
  onChangeAction: (characterId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.characterId === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? options.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            o.characterId.toLowerCase().includes(q),
        )
      : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.characterId === value),
      ),
    );
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (open)
      listRef.current
        ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(o?: Species) {
    if (o) {
      onChangeAction(o.characterId);
      setOpen(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(filtered[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(filtered.length - 1);
    }
  }

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="field flex w-full items-center gap-2 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {selected ? (
          <>
            <WikiIcon icon={selected.icon} alt="" className="size-6 shrink-0" />
            <span className="truncate">{selected.name}</span>
            <span className="ml-auto flex shrink-0 gap-1">
              {selected.elements.map((el) => (
                <Dot key={el} el={el} />
              ))}
            </span>
          </>
        ) : (
          <span className="truncate text-subtle">
            {humanizeId(value) || "Select species"}
          </span>
        )}
        <Chevron className="ml-1 size-4 shrink-0 text-subtle" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-line bg-raised shadow-lg">
          <div className="border-b border-line p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search species…"
              aria-label="Search species"
              className="field field-sm w-full"
            />
          </div>
          <ul
            ref={listRef}
            role="listbox"
            className="scroll-slim max-h-64 overflow-y-auto py-1"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-subtle">No matches</li>
            )}
            {filtered.map((o, i) => {
              const isSel = o.characterId === value;
              return (
                <li
                  key={o.characterId}
                  data-idx={i}
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={`flex cursor-pointer items-center gap-2.5 px-3 py-1.5 ${i === active ? "bg-accent-soft" : ""}`}
                >
                  <WikiIcon icon={o.icon} alt="" className="size-7 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {o.name}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {o.elements.map((el) => (
                      <Dot key={el} el={el} />
                    ))}
                  </span>
                  {isSel && <Check className="size-4 shrink-0 text-accent" />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Dot({ el }: { el: string }) {
  return (
    <span
      className="size-2.5 rounded-full"
      title={el}
      style={{ background: ELEMENT_COLORS[el] ?? "var(--color-subtle)" }}
    />
  );
}
function Chevron({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 8l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Check({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 10l3.5 3.5L15 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
