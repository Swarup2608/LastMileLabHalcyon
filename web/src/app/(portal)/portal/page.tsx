import type { Metadata } from "next";
import HomeView from "@/components/console/HomeView";

export const metadata: Metadata = { title: "Home · Halcyon" };

// Staff land on Today, clients on Home: real data only. The simulation's command center is on /portal/simulation.
export default function HomePage() {
  return <HomeView />;
}
