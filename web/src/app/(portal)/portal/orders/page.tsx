import type { Metadata } from "next";
import { Suspense } from "react";
import OrdersView from "@/components/console/OrdersView";

export const metadata: Metadata = { title: "Orders · Halcyon" };

// Suspense: OrdersView reads ?q= (the Clients page links here with a client's name).
export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersView />
    </Suspense>
  );
}
