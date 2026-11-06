"use client";

import Link from "next/link";
import { useConsoleUser } from "./ConsoleShell";

// The Users page's tabs, one route each so the route guards and links stay as they were: Staff (/portal/team) for
// admins only, and Clients (/portal/clients) for all staff. A contributor sees Clients alone, so no tabs.
export default function UsersTabs({ current }: { current: "staff" | "clients" }) {
  const user = useConsoleUser();
  if (user.role !== "admin") return null;
  return (
    <nav className="ptabs" aria-label="Users" style={{ marginBottom: 16 }}>
      {(
        [
          ["staff", "Staff", "/portal/team"],
          ["clients", "Clients", "/portal/clients"],
        ] as const
      ).map(([key, label, href]) => (
        <Link key={key} href={href} aria-current={current === key ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
