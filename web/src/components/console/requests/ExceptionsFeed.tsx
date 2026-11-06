"use client";

import { useEffect } from "react";
import { useConsoleUser } from "@/components/console/ConsoleShell";
import { stampIntake } from "@/lib/order-request";
import { emailExceptions } from "./emailExceptions";
import { useStaffRequests } from "./useEmailedRows";

// Staff: counts the emailed orders that need a person for the header bell, and stamps the order intake time on
// requests that have become ready, live from the shared inbox poll on every page. Real data only: the simulation has
// its own exceptions. Mounted once by the shell; renders nothing.
export default function ExceptionsFeed({ onCount }: { onCount: (n: number) => void }) {
  const user = useConsoleUser();
  const isStaff = user.role !== "client";
  const { requests, stock, edits } = useStaffRequests(isStaff);

  useEffect(() => {
    if (!isStaff || !requests || !stock) return;
    // On every staff page, so a request made ready by the client's answers gets its intake time within one poll.
    stampIntake(requests);
    // One entry per order, so the count is orders.
    onCount(emailExceptions(requests, (id) => edits[id] ?? {}, stock.products, stock.warehouses).length);
  }, [isStaff, requests, stock, edits, onCount]);

  return null;
}
