import type { Metadata } from "next";
import { RoleGate } from "@/components/console/ConsoleShell";
import ClientProductsView from "@/components/console/ClientProductsView";

export const metadata: Metadata = { title: "Products · Halcyon" };

// The client's real catalogue and stock, from /api/products.
export default function ProductsPage() {
  return (
    <RoleGate roles={["client"]}>
      <ClientProductsView />
    </RoleGate>
  );
}
