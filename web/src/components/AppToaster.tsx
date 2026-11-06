"use client";

import { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";

const PHONE = "(max-width: 640px)";

// The one toast host for the site, mounted in each root layout; anything can then call toast() / toast.success() /
// toast.error() from "react-hot-toast". Colors come from the layout's own tokens (the portal's --brand family, the
// marketing site's --band family), so toasts follow light and dark mode. Bottom right on desktop; on phones, top
// centre under the header (`phoneTop` px down), clear of the thumb zone and the portal's bottom dock.
export default function AppToaster({ phoneTop = 16 }: { phoneTop?: number }) {
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <Toaster
      position={phone ? "top-center" : "bottom-right"}
      gutter={8}
      containerStyle={phone ? { top: `calc(${phoneTop}px + env(safe-area-inset-top, 0px))` } : { right: 24, bottom: 24 }}
      toastOptions={{
        duration: 3000,
        style: {
          background: "var(--brand, var(--band))",
          color: "var(--on-brand, var(--band-fg))",
          borderRadius: 12,
          padding: "12px 16px",
          fontSize: 14,
          lineHeight: "20px",
          boxShadow: "0 8px 24px rgba(0,0,0,.24)",
          maxWidth: "min(420px, calc(100vw - 32px))",
        },
        success: { iconTheme: { primary: "var(--brand-accent, var(--ok))", secondary: "var(--brand, var(--band))" } },
        // Errors stay up longer: they usually ask the reader to do something.
        error: { duration: 5000, iconTheme: { primary: "var(--bad, var(--risk))", secondary: "var(--brand, var(--band))" } },
      }}
    />
  );
}
