import ConsoleShell from "@/components/console/ConsoleShell";

// Header and the running portal engine, shared by every /portal page (the demo clock footer shows on Simulation only).
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
