"use client";

import { useEffect, useRef } from "react";
import { usePortalEngine } from "@/components/console/ConsoleShell";

// A portal page drawn by the engine: React supplies the element, the engine fills it with `view` (one of
// components/portal/views) and keeps it live until the page is left. The engine itself (lib/portal/engine.ts) runs in
// the /portal layout.
export default function EngineView({ view, param }: { view: string; param?: string }) {
  const { engine, failed } = usePortalEngine();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!engine || !ref.current) return;
    return engine.show(ref.current, view, param);
  }, [engine, view, param]);

  if (failed) {
    return (
      <div className="card empty" role="alert">
        We couldn’t load the warehouse network and inventory from Halcyon. Refresh the page to try again.
      </div>
    );
  }
  return <div ref={ref} className="view" aria-busy={!engine}></div>;
}
