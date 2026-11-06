import { redirect } from "next/navigation";

// The rules are the simulation's, so they live on the admin-only Simulation; old links land there.
export default function RulesPage() {
  redirect("/portal/simulation/rules");
}
