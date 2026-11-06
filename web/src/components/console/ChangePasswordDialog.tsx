"use client";

import { useEffect, useRef, useState, type SubmitEvent } from "react";
import Icon from "@/components/Icon";
import Spinner from "@/components/Spinner";
import { ApiError, type Principal } from "@/lib/api";
import { updateAccount } from "@/lib/auth";
import { PASSWORD_HINT, passwordProblem } from "@/lib/password";

const EMPTY = { current: "", next: "", confirm: "" };

// Popup for changing your own password. The API checks the current one, ends every other session and gives this
// browser a fresh one, so the user stays signed in here.
export default function ChangePasswordDialog({
  user,
  open,
  onClose,
  onChanged,
}: {
  user: Principal;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setForm(EMPTY);
      setErrors({});
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!form.current) found.current = "Enter your current password.";
    const weak = passwordProblem(form.next);
    if (weak) found.next = weak;
    else if (form.next === form.current) found.next = "Choose a password different from your current one.";
    if (form.confirm !== form.next) found.confirm = "The passwords don’t match.";
    setErrors(found);
    if (Object.keys(found).length) return;

    setPending(true);
    try {
      await updateAccount(user, { currentPassword: form.current, newPassword: form.next });
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setErrors({ current: err.message + "." });
      else if (err instanceof ApiError && err.status === 400) {
        const { newPassword, currentPassword, form } = err.errorsFor(["newPassword", "currentPassword"]);
        setErrors({ next: newPassword, current: currentPassword, form });
      } else if (err instanceof ApiError && err.status === 429) setErrors({ form: "Too many attempts. Try again in a few minutes." });
      else if (err instanceof ApiError) setErrors({ form: `Halcyon couldn’t change your password: ${err.message}` });
      else setErrors({ form: "We couldn’t reach Halcyon. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  }

  const field = (key: keyof typeof EMPTY, label: string, autoComplete: string, help?: string) => (
    <label className="field">
      {label}
      <input
        className="input"
        type="password"
        autoComplete={autoComplete}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        aria-invalid={!!errors[key] || undefined}
      />
      {errors[key] ? <span className="ferr">{errors[key]}</span> : help ? <span className="help">{help}</span> : null}
    </label>
  );

  return (
    <dialog
      ref={ref}
      className="dlg"
      aria-labelledby="pw-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <form className="dlg-b" onSubmit={onSubmit} noValidate>
        <div>
          <h2 id="pw-title">Change password</h2>
          <p className="muted" style={{ fontSize: 14, lineHeight: "20px", marginTop: 4 }}>
            You stay signed in here; every other device is signed out.
          </p>
        </div>
        {/* Lets password managers attach the new password to the right account. */}
        <input type="email" autoComplete="username" value={user.email} readOnly hidden />
        {field("current", "Current password", "current-password")}
        {field("next", "New password", "new-password", PASSWORD_HINT)}
        {field("confirm", "Confirm new password", "new-password")}
        {errors.form && <p className="callout bad" role="alert">{errors.form}</p>}
        <div className="dlg-acts">
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className="btn btn-brand" type="submit" disabled={pending} aria-busy={pending}>
            {pending ? <Spinner /> : <Icon name="lock-simple" />}
            {pending ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
