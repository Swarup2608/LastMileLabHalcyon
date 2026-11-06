"use client";

import { useEffect, useRef, useState, type SubmitEvent } from "react";
import Icon from "@/components/Icon";
import Spinner from "@/components/Spinner";
import { ApiError, type StaffRole } from "@/lib/api";
import { STAFF_ROLES, staffApi, type Staff } from "@/lib/staff";

const ROLE_LABEL: Record<StaffRole, string> = { admin: "Admin", contributor: "Contributor" };
const EMPTY = { name: "", email: "", role: "contributor" as StaffRole };

// Popup form that adds a contributor or admin. The API generates their starting password; onAdded receives it to
// show once. Uses the native <dialog>, so Escape, focus trapping and the
// backdrop come from the browser; clicking the backdrop closes it too.
export default function AddMemberDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (member: Staff, temporaryPassword: string) => void;
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
    if (!form.name.trim()) found.name = "Enter their name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) found.email = "Enter a valid email.";
    setErrors(found);
    if (Object.keys(found).length) return;

    setPending(true);
    try {
      const { staff: member, temporaryPassword } = await staffApi.create({
        role: form.role,
        name: form.name.trim(),
        email: form.email.trim(),
      });
      onAdded(member, temporaryPassword);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors(err.errorsFor(["name", "email", "role"]));
      else if (err instanceof ApiError && err.status === 409) setErrors({ email: err.message + "." });
      else if (err instanceof ApiError) setErrors({ form: `Halcyon couldn’t add this member: ${err.message}` });
      else setErrors({ form: "We couldn’t reach Halcyon. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="dlg"
      aria-labelledby="add-member-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <form className="dlg-b" onSubmit={onSubmit} noValidate>
        <div>
          <h2 id="add-member-title">Add a team member</h2>
          <p className="muted" style={{ fontSize: 14, lineHeight: "20px", marginTop: 4 }}>
            Halcyon generates their starting password; you’ll see it once after adding them.
          </p>
        </div>
        <div className="grid2">
          <label className="field">
            Name
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              aria-invalid={!!errors.name || undefined}
            />
            {errors.name && <span className="ferr">{errors.name}</span>}
          </label>
          <label className="field">
            Work email
            <input
              className="input"
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              aria-invalid={!!errors.email || undefined}
            />
            {errors.email && <span className="ferr">{errors.email}</span>}
          </label>
        </div>
        <div className="field">
          Role
          <div className="seg" role="group" aria-label="Role" style={{ width: "max-content" }}>
            {STAFF_ROLES.map((role) => (
              <button key={role} type="button" aria-pressed={form.role === role} onClick={() => setForm({ ...form, role })}>
                {ROLE_LABEL[role]}
              </button>
            ))}
          </div>
          <span className="help">
            {form.role === "admin" ? "Admins also manage the team and client logins." : "Contributors work the operations console."}
          </span>
        </div>
        {errors.form && <p className="callout bad" role="alert">{errors.form}</p>}
        <div className="dlg-acts">
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className="btn btn-brand" type="submit" disabled={pending} aria-busy={pending}>
            {pending ? <Spinner /> : <Icon name="plus" />}
            {pending ? "Adding…" : "Add member"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
