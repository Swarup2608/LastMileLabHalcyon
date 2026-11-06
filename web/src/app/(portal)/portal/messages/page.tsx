import type { Metadata } from "next";
import { RoleGate } from "@/components/console/ConsoleShell";
import ClientMessagesView from "@/components/console/ClientMessagesView";

export const metadata: Metadata = { title: "Messages · Halcyon" };

// The updates on the client's real orders.
export default function MessagesPage() {
  return (
    <RoleGate roles={["client"]}>
      <ClientMessagesView />
    </RoleGate>
  );
}
