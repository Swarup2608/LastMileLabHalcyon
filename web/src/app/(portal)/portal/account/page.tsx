import type { Metadata } from "next";
import AccountView from "@/components/console/AccountView";
import { RoleGate } from "@/components/console/ConsoleShell";

export const metadata: Metadata = { title: "Account · Halcyon" };

export default function AccountPage() {
  return (
    <RoleGate roles={["admin", "contributor", "client"]}>
      <AccountView />
    </RoleGate>
  );
}
