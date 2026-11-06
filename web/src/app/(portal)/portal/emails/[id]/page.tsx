import type { Metadata } from "next";
import { RoleGate } from "@/components/console/ConsoleShell";
import ResolveView from "@/components/console/requests/ResolveView";

type Params = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Order request · Halcyon" };

export default async function EmailRequestPage({ params }: Params) {
  const { id } = await params;
  return (
    <RoleGate roles={["admin", "contributor"]}>
      <ResolveView id={decodeURIComponent(id)} />
    </RoleGate>
  );
}
