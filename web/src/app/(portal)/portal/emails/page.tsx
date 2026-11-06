import type { Metadata } from "next";
import { RoleGate } from "@/components/console/ConsoleShell";
import EmailsView from "@/components/console/EmailsView";

export const metadata: Metadata = { title: "Emails · Halcyon" };

export default function EmailsPage() {
  return (
    <RoleGate roles={["admin", "contributor"]}>
      <EmailsView />
    </RoleGate>
  );
}
