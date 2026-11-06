import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import EngineView from "@/components/EngineView";
import OrdersView from "@/components/console/OrdersView";

type Params = { params: Promise<{ view: string[] }> };

const TITLE: Record<string, string> = { orders: "Simulated orders", exceptions: "Simulated exceptions", carriers: "Simulated carriers", rules: "Simulation rules" };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const [view, id] = (await params).view;
  return { title: `${id ? decodeURIComponent(id) : TITLE[view] ?? "Simulation"} · Halcyon` };
}

// The simulation's other screens (admins only, see layout): its orders list and each order, its exceptions, carriers
// and rules. The engine's own links point here (lib/portal/types.ts viewPath).
export default async function SimulationViewPage({ params }: Params) {
  const [view, id, ...rest] = (await params).view;
  if (rest.length) notFound();
  if (view === "orders" && id) return <EngineView view="order" param={decodeURIComponent(id)} />;
  if (id) notFound();
  if (view === "orders")
    return (
      // Suspense: OrdersView reads ?q= (the simulation's client cards link here with a client's name).
      <Suspense>
        <OrdersView source="sim" />
      </Suspense>
    );
  if (view === "exceptions" || view === "carriers" || view === "rules") return <EngineView view={view} />;
  notFound();
}
