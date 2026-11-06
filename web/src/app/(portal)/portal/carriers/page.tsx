import type { Metadata } from "next";
import { RoleGate } from "@/components/console/ConsoleShell";
import CarrierPlan from "@/components/console/orders/CarrierPlan";

export const metadata: Metadata = { title: "Carriers · Halcyon" };

// The real carrier plan: the carrier agent's plan for today's same-day orders, from /api/carrier-plan. The simulated
// carriers are on the Simulation page.
export default function CarriersPage() {
  return (
    <RoleGate roles={["admin", "contributor"]}>
      <div className="page-h">
        <div>
          <h1>Carriers</h1>
          <p>Today’s carrier plan for every routed order with no carrier, made once the same-day cutoff has passed.</p>
        </div>
      </div>
      <CarrierPlan />
    </RoleGate>
  );
}
