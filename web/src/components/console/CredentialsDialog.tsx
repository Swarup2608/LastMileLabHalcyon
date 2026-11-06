"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";

export interface Credentials {
  title: string;
  message: string;
  email: string;
  password: string;
}

// Shows a generated password exactly once, with a copy button. The API never returns it again, so the admin passes
// it on now; the owner replaces it with Change password after signing in.
export default function CredentialsDialog({ credentials, onClose }: { credentials: Credentials | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (credentials && !dlg.open) {
      setCopied(false);
      dlg.showModal();
    } else if (!credentials && dlg.open) {
      dlg.close();
    }
  }, [credentials]);

  async function copy() {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(`Email: ${credentials.email}\nPassword: ${credentials.password}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <dialog ref={ref} className="dlg" aria-labelledby="cred-title" onClose={onClose}>
      {credentials && (
        <div className="dlg-b">
          <div>
            <h2 id="cred-title">{credentials.title}</h2>
            <p className="muted" style={{ fontSize: 14, lineHeight: "20px", marginTop: 4 }}>{credentials.message}</p>
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 16px", fontSize: 14 }}>
            <dt className="muted">Email</dt>
            <dd className="mono">{credentials.email}</dd>
            <dt className="muted">Password</dt>
            <dd className="mono" style={{ fontSize: 16 }}>{credentials.password}</dd>
          </dl>
          <p className="callout warn" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
            <Icon name="warning" />
            This password won’t be shown again.
          </p>
          <div className="dlg-acts">
            <button className="btn btn-secondary" type="button" onClick={copy}>
              {copied ? <Icon name="check-circle" /> : null}
              {copied ? "Copied" : "Copy details"}
            </button>
            <button className="btn btn-brand" type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
