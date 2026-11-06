import type { Metadata } from "next";
import { RoleGate } from "@/components/console/ConsoleShell";
import ApiOrderForm from "@/components/console/requests/ApiOrderForm";

export const metadata: Metadata = { title: "New order · Halcyon" };

// A real order through the API (POST /api/order-requests), so staff see it; not the engine's simulated order form.
export default function NewOrderPage() {
  return (
    <RoleGate roles={["client"]}>
      <ApiOrderForm />
    </RoleGate>
  );
}
