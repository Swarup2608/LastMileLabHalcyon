"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "@/components/Icon";

const TABS = [
  ["Overview", "/portal/simulation"],
  ["Orders", "/portal/simulation/orders"],
  ["Exceptions", "/portal/simulation/exceptions"],
  ["Carriers", "/portal/simulation/carriers"],
  ["Rules", "/portal/simulation/rules"],
] as const;

// The top of every Simulation page (admins only): the "Simulated data" badge, so a simulated screen is never mistaken
// for a real one, and a tab per simulated screen. An order page keeps Orders current.
export default function SimulationNav() {
  const pathname = usePathname();
  const current = [...TABS].reverse().find(([, href]) => pathname === href || pathname.startsWith(`${href}/`))?.[1];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <span className="chip warn" role="note" title="Generated in this browser by the simulation. Nothing here is real or saved.">
        <Icon name="warning" />
        Simulated data
      </span>
      <nav className="ptabs" aria-label="Simulation">
        {TABS.map(([label, href]) => (
          <Link key={href} href={href} aria-current={current === href ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
