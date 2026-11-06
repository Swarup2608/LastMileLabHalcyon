import type { Metadata, Viewport } from "next";
import AppToaster from "@/components/AppToaster";
import "./portal.css";

export const metadata: Metadata = {
  title: "Halcyon portal",
  description: "Halcyon logistics platform: client portal and operations console, from order email to delivery.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Separate root layout: the portal stylesheet uses global selectors (.btn, .card, .nav ...) that must not leak into the marketing site.
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        {children}
        <AppToaster phoneTop={88} />
      </body>
    </html>
  );
}
