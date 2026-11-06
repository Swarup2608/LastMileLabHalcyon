import type { Metadata } from "next";
import ClientSignupForm from "@/components/console/ClientSignupForm";
import { RoleGate } from "@/components/console/ConsoleShell";

export const metadata: Metadata = { title: "Sign up a client · Halcyon" };

export default function ClientSignupPage() {
  return (
    <RoleGate roles={["admin"]}>
      <ClientSignupForm />
    </RoleGate>
  );
}
