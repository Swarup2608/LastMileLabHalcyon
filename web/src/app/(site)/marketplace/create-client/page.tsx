import type { Metadata } from "next";
import CreateClientForm from "@/components/marketplace/CreateClientForm";

export const metadata: Metadata = { title: "Create your client · Halcyon" };

export default function CreateClientPage() {
  return <CreateClientForm />;
}
