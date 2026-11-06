import type { Metadata } from "next";
import ClientsView from "@/components/console/ClientsView";
import { RoleGate } from "@/components/console/ConsoleShell";

export const metadata: Metadata = { title: "Users · Clients · Halcyon" };

export default function ClientsPage() {
  return (
    <RoleGate roles={["admin", "contributor"]}>
      <ClientsView />
    </RoleGate>
  );
}
