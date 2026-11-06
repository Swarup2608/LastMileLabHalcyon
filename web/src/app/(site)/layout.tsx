import type { Metadata, Viewport } from "next";
import AppToaster from "@/components/AppToaster";
import "../globals.css";

export const metadata: Metadata = {
  title: "Halcyon",
  description:
    "Halcyon reads order emails, routes each order to the nearest warehouse with stock and plans carriers after the same-day cutoff.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* The portal's fonts, loaded by family name so the 3D yard's canvas labels can draw in Geist too. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400..800&family=Geist+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
