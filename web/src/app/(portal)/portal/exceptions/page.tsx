import type { Metadata } from "next";
import { RoleGate } from "@/components/console/ConsoleShell";
import ExceptionsView from "@/components/console/ExceptionsView";

export const metadata: Metadata = { title: "Exceptions · Halcyon" };

// Real orders that need a person, live from the inbox. The simulation's exceptions are on the Simulation page.
export default function ExceptionsPage() {
  return (
    <RoleGate roles={["admin", "contributor"]}>
      <ExceptionsView />
    </RoleGate>
  );
}
