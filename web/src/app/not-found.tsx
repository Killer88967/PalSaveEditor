import type { Metadata } from "next";
import { NotFoundPanel } from "@/components/notFound/not-found-panel";
// import { PeekabooPal } from "@/components/notFound/peekaboo-pal";

export const metadata: Metadata = {
  title: "Page not found · PalSaveEditor",
};

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center">
      <NotFoundPanel />
      {/* <PeekabooPal /> */}
    </main>
  );
}
