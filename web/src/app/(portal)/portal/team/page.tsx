import type { Metadata } from "next";
import { RoleGate } from "@/components/console/ConsoleShell";
import TeamView from "@/components/console/TeamView";

export const metadata: Metadata = { title: "Users · Staff · Halcyon" };

export default function TeamPage() {
  return (
    <RoleGate roles={["admin"]}>
      <TeamView />
    </RoleGate>
  );
}
