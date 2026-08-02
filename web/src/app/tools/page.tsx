import type { Metadata } from "next";
import Link from "next/link";
import { Converter } from "@/components/converter";
import { AlertIcon, ArrowRightIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Decompile & recompile",
  description:
    "Convert a Palworld .sav container to raw Unreal GVAS bytes and back, without opening an editing session.",
};

const HEADER_FIELDS = [
  {
    range: "0x00 – 0x03",
    name: "uncompressedSize",
    detail:
      "u32, little-endian. Length of the GVAS payload after decompression.",
  },
  {
    range: "0x04 – 0x07",
    name: "compressedSize",
    detail: "u32, little-endian. Length of the compressed body that follows.",
  },
  {
    range: "0x08 – 0x0A",
    name: "magic",
    detail: "`PlZ` for zlib saves (pre-0.6) or `PlM` for Oodle Kraken (0.6+).",
  },
  {
    range: "0x0B",
    name: "saveType",
    detail:
      "Codec selector. `0x31` is one zlib pass, `0x32` is two nested passes.",
  },
  {
    range: "0x0C – end",
    name: "body",
    detail: "The compressed GVAS payload itself.",
  },
] as const;

export default function ToolsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Decompile &amp; recompile
        </h1>
        <p className="max-w-2xl text-muted">
          Convert between the Palworld <code>.sav</code> container and the raw
          Unreal <code>.gvas</code> payload inside it. Useful for diffing two
          saves, feeding another tool, or checking that a file is readable at
          all.
        </p>
      </header>

      <Converter />

      <div className="alert alert-warning">
        <AlertIcon className="mt-0.5 size-5 shrink-0 text-warning" />
        <p>
          Recompiled saves are still saves — back up your world before putting
          one back. Converting does not change any values, but an interrupted
          download or an edited GVAS can produce a file the game refuses.
        </p>
      </div>

      <section className="card overflow-hidden">
        <header className="border-b border-line bg-raised px-4 py-3">
          <h2 className="font-medium">Anatomy of the container</h2>
          <p className="text-xs text-muted">
            Everything before the payload is twelve bytes of header
          </p>
        </header>
        <div className="scroll-slim overflow-x-auto">
          <table className="w-full min-w-136 text-left text-sm">
            <thead className="text-xs text-subtle">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Offset
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Field
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Meaning
                </th>
              </tr>
            </thead>
            <tbody>
              {HEADER_FIELDS.map((field) => (
                <tr key={field.name} className="border-t border-line">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-violet">
                    {field.range}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-accent">
                    {field.name}
                  </td>
                  <td className="px-4 py-2 text-muted">{field.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">Want to change values, not formats?</h2>
          <p className="mt-1 text-sm text-muted">
            The editor parses the property tree so you can edit Pals,
            inventories and individual scalars, then export a validated save.
          </p>
        </div>
        <Link href="/editor" className="btn btn-primary">
          Open the editor
          <ArrowRightIcon className="size-4" />
        </Link>
      </section>
    </div>
  );
}
