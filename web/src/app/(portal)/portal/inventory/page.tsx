import type { Metadata } from "next";
import { RoleGate } from "@/components/console/ConsoleShell";
import InventoryView from "@/components/console/InventoryView";

export const metadata: Metadata = { title: "Inventory · Halcyon" };

export default function InventoryPage() {
  return (
    <RoleGate roles={["admin", "contributor"]}>
      <InventoryView />
    </RoleGate>
  );
}
