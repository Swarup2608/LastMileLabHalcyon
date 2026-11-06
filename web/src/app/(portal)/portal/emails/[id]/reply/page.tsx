import type { Metadata } from "next";
import { RoleGate } from "@/components/console/ConsoleShell";
import ThreadView from "@/components/console/requests/ThreadView";

type Params = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Request info · Halcyon" };

export default async function EmailReplyPage({ params }: Params) {
  const { id } = await params;
  return (
    <RoleGate roles={["admin", "contributor"]}>
      <ThreadView id={decodeURIComponent(id)} />
    </RoleGate>
  );
}
