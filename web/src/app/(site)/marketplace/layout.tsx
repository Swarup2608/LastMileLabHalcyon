import type { Metadata } from "next";
import MarketNav from "@/components/marketplace/MarketNav";
import "./marketplace.css";

export const metadata: Metadata = {
  title: "Marketplace · Halcyon",
  description: "Browse Halcyon's catalogue and place an order. Open to everyone.",
};

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MarketNav />
      {children}
    </>
  );
}
