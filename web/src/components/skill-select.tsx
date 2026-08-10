"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SkillOption } from "@/lib/skill-catalog";

export function SkillSelect({
  value,
  options,
  onChangeAction,
  placeholder = "Choose a skill…",
}: {
  value: string;
  options: SkillOption[];
  onChangeAction: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? options.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            o.value.toLowerCase().includes(q),
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
    setQuery(""); // eslint-disable-line react-hooks/set-state-in-effect
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setActive(0), [query]); // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (open)
      listRef.current
        ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(o?: SkillOption) {
    if (o) {
      onChangeAction(o.value);
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
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative min-w-0 flex-1"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="field field-sm flex w-full items-center gap-2 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {selected?.color && (
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: selected.color }}
          />
        )}
        <span className={`truncate ${selected ? "" : "text-subtle"}`}>
          {selected?.name ?? (value || placeholder)}
        </span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-72 max-w-[80vw] overflow-hidden rounded-lg border border-line bg-raised shadow-lg">
          <div className="border-b border-line p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              aria-label="Search skills"
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
            {filtered.map((o, i) => (
              <li
                key={o.value}
                data-idx={i}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
                className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-accent-soft" : ""}`}
              >
                <div className="flex items-center gap-2">
                  {o.color && (
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: o.color }}
                    />
                  )}
                  <span className="truncate text-sm font-medium">{o.name}</span>
                </div>
                {o.sub && (
                  <p className="truncate text-xs text-subtle">{o.sub}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
