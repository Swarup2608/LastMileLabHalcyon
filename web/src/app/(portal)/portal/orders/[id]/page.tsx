import type { Metadata } from "next";
import Link from "next/link";
import Icon from "@/components/Icon";
import { RoleGate } from "@/components/console/ConsoleShell";
import ClientOrderView from "@/components/console/requests/ClientOrderView";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return { title: `${decodeURIComponent((await params).id)} · Halcyon` };
}

// A client's real order (REQ-…, from the API). Staff open real orders on Resolve; simulated orders open on the
// Simulation's order page, so any other id isn't an order here.
export default async function OrderPage({ params }: Params) {
  const id = decodeURIComponent((await params).id);
  if (id.startsWith("REQ-"))
    return (
      <RoleGate roles={["client"]}>
        <ClientOrderView refId={id} />
      </RoleGate>
    );
  return (
    <div className="card empty" role="alert">
      <Icon name="package" className="lg" />
      There’s no order {id}. <Link href="/portal/orders">Back to Orders</Link>
    </div>
  );
}
