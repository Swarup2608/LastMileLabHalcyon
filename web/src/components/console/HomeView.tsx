"use client";

import ClientHome from "./ClientHome";
import { useConsoleUser } from "./ConsoleShell";
import TodayView from "./TodayView";

// /portal: Today for staff, Home for clients. Both show real data only.
export default function HomeView() {
  return useConsoleUser().role === "client" ? <ClientHome /> : <TodayView />;
}
