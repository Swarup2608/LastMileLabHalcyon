import { RoleGate } from "@/components/console/ConsoleShell";
import SimulationNav from "@/components/console/SimulationNav";

// Every simulated screen lives here, admins only, under the "Simulated data" badge. No other portal page shows
// simulated data. The shell shows the demo clock on these pages.
export default function SimulationLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGate roles={["admin"]}>
      <SimulationNav />
      {children}
    </RoleGate>
  );
}
