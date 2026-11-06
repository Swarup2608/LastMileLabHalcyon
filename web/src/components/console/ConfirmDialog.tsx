"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Spinner from "@/components/Spinner";
import { ApiError } from "@/lib/api";

export interface ConfirmRequest {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  // Runs on confirm; the popup shows a spinner meanwhile and stays open with the error if it throws.
  action: () => Promise<void>;
}

// Popup that asks before doing something with consequences, in place of the browser's confirm().
export default function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (request && !dlg.open) dlg.showModal();
    else if (!request && dlg.open) dlg.close();
  }, [request]);

  const close = () => {
    if (pending) return;
    setError(null);
    onClose();
  };

  async function confirm() {
    if (!request) return;
    setPending(true);
    setError(null);
    try {
      await request.action();
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Halcyon couldn’t do that: ${err.message}${err.status === 404 ? " (is the API up to date?)" : ""}`
          : "We couldn’t reach Halcyon. Check your connection and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="dlg"
      role="alertdialog"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClose={() => setError(null)}
    >
      {request && (
        <div className="dlg-b">
          <div>
            <h2 id="confirm-title">{request.title}</h2>
            <div className="muted" style={{ fontSize: 14, lineHeight: "20px", marginTop: 8, display: "grid", gap: 8 }}>
              {request.message}
            </div>
          </div>
          {error && (
            <p className="callout bad" role="alert">
              {error}
            </p>
          )}
          <div className="dlg-acts">
            <button className="btn btn-secondary" type="button" onClick={close} disabled={pending}>
              Cancel
            </button>
            <button
              className={`btn ${request.danger ? "btn-danger" : "btn-brand"}`}
              type="button"
              onClick={confirm}
              disabled={pending}
              aria-busy={pending}
            >
              {pending && <Spinner />}
              {pending ? "Working…" : request.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
