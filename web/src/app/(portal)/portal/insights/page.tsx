import type { Metadata } from "next";
import { RoleGate } from "@/components/console/ConsoleShell";
import SameDayCharts from "@/components/console/orders/SameDayCharts";

export const metadata: Metadata = { title: "Insights · Halcyon" };

// Staff analysis, read-only: for now the same-day performance charts.
export default function InsightsPage() {
  return (
    <RoleGate roles={["admin", "contributor"]}>
      <div className="page-h">
        <div>
          <h1>Insights</h1>
          <p>How deliveries are performing, from the order history.</p>
        </div>
      </div>
      <SameDayCharts />
    </RoleGate>
  );
}
