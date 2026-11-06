import type { Metadata } from "next";
import AgentFeed from "@/components/AgentFeed";
import EngineView from "@/components/EngineView";

export const metadata: Metadata = { title: "Simulation · Halcyon" };

// The simulation's command center with the demo clock's controls (the layout shows the clock dock on these pages), the
// week reports and the Whole simulation table, with the live agents' feed above it. Admins only (see layout).
export default function SimulationPage() {
  return (
    <>
      <AgentFeed />
      <EngineView view="overview" param="simulation" />
    </>
  );
}
