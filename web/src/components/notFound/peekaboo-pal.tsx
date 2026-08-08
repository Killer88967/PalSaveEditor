"use client";

import { useState } from "react";
import { WikiIcon } from "@/components/wiki-browser";

const ISSUES_URL = "https://github.com/Killer88967/PalSaveEditor/issues";

export function PeekabooPal() {
  const [hovered, setHovered] = useState(false);
  const [helper, setHelper] = useState(false);
  const [ducking, setDucking] = useState(false);

  function swap() {
    if (ducking) return;
    setDucking(true);
    window.setTimeout(() => {
      setHelper((h) => !h);
      setDucking(false);
    }, 280);
  }

  // % of its own height: hidden below the floor / peeking / fully up
  const y = ducking ? "115%" : hovered || helper ? "0%" : "50%";

  return (
    <div className="pointer-events-none absolute bottom-0 right-4 z-20 hidden sm:block sm:right-8">
      {helper && !ducking && (
        <a
          href={ISSUES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="pointer-events-auto mb-2 block max-w-44 rounded-xl border border-line bg-raised px-3 py-2 text-sm shadow-lg transition hover:bg-sunken"
        >
          Need a hand? <span className="text-accent">Report an issue →</span>
        </a>
      )}

      <button
        type="button"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onClick={swap}
        aria-label={
          helper ? "Report an issue" : "Say hi to Depresso — tap for help"
        }
        className="pointer-events-auto block h-28 w-28 overflow-hidden sm:h-36 sm:w-36"
      >
        <span
          className="block transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: `translateY(${y})` }}
        >
          <WikiIcon
            icon={helper ? "wizardowl" : "negativekoala"}
            alt=""
            className="size-28 drop-shadow-xl sm:size-36"
          />
        </span>
      </button>
    </div>
  );
}
