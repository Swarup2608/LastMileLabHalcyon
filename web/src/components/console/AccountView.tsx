"use client";

import { useState, type SubmitEvent } from "react";
import toast from "react-hot-toast";
import Icon from "@/components/Icon";
import Spinner from "@/components/Spinner";
import { ApiError, type Role } from "@/lib/api";
import { updateAccount } from "@/lib/auth";
import ChangePasswordDialog from "./ChangePasswordDialog";
import DeliveryCutoffCard from "./DeliveryCutoffCard";
import { useConsoleUser } from "./ConsoleShell";

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", contributor: "Contributor", client: "Client" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The signed-in user's account details. The name changes freely; a new email asks for the current password. The
// password itself is changed from its own popup. Field problems show under their field; the outcome is a toast.
export default function AccountView() {
  const initial = useConsoleUser();
  const [user, setUser] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const nextName = name.trim();
  const nextEmail = email.trim().toLowerCase();
  const nameChanged = nextName !== user.name;
  const emailChanged = nextEmail !== user.email;
  const locked = user.isDemo;

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!nextName) found.name = "Enter your name.";
    if (!EMAIL_RE.test(nextEmail)) found.email = "Enter a valid email.";
    if (emailChanged && !currentPassword) found.currentPassword = "Enter your current password to change your email.";
    setErrors(found);
    if (Object.keys(found).length || (!nameChanged && !emailChanged)) return;

    setPending(true);
    try {
      const updated = await updateAccount(user, {
        name: nameChanged ? nextName : undefined,
        email: emailChanged ? nextEmail : undefined,
        currentPassword: emailChanged ? currentPassword : undefined,
      });
      setUser(updated);
      setName(updated.name);
      setEmail(updated.email);
      setCurrentPassword("");
      toast.success(emailChanged ? "Saved. Sign in with your new email from now on. You’re signed out everywhere else." : "Saved.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && err.message === "Current password is incorrect") {
        setErrors({ currentPassword: err.message + "." });
      } else if (err instanceof ApiError && err.status === 403) {
        setErrors({});
        toast.error(err.message + ".");
      } else if (err instanceof ApiError && err.status === 409) {
        setErrors({ email: err.message + "." });
      } else if (err instanceof ApiError && err.status === 400) {
        const { form, ...fields } = err.errorsFor(["name", "email", "currentPassword"]);
        setErrors(fields);
        if (form) toast.error(form);
      } else if (err instanceof ApiError && err.status === 429) {
        setErrors({});
        toast.error("Too many attempts. Try again in a few minutes.");
      } else if (err instanceof ApiError) {
        setErrors({});
        toast.error(`Halcyon couldn’t save your changes: ${err.message}`);
      } else {
        setErrors({});
        toast.error("We couldn’t reach Halcyon. Check your connection and try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="page-h">
        <div>
          <p className="kick">Account settings</p>
          <h1>{user.name}</h1>
          <p>Your name and the email you sign in with.</p>
        </div>
      </div>

      {locked && (
        <p className="callout warn" role="status" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, maxWidth: 720 }}>
          <Icon name="warning" />
          This is a demo account, listed on the sign-in page for anyone to use, so its details can’t be changed.
        </p>
      )}

      {/* Side by side: the account on the left, an admin's same-day cutoff on the right; one column on narrow screens. */}
      <div style={{ display: "grid", gap: 24, alignItems: "start", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))" }}>
        <div style={{ display: "grid", gap: 24 }}>
          <form className="card" onSubmit={onSubmit} noValidate style={{ padding: 24, display: "grid", gap: 16 }}>
            <h2 style={{ fontSize: 18, lineHeight: "28px" }}>Profile</h2>
            <div className="grid2">
              <label className="field">
                Name
                <input
                  className="input"
                  autoComplete="name"
                  value={name}
                  disabled={locked}
                  onChange={(e) => setName(e.target.value)}
                  aria-invalid={!!errors.name || undefined}
                />
                {errors.name && <span className="ferr">{errors.name}</span>}
              </label>
              <label className="field">
                Email
                <input
                  className="input"
                  type="email"
                  autoComplete="username"
                  value={email}
                  disabled={locked}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!!errors.email || undefined}
                />
                {errors.email ? <span className="ferr">{errors.email}</span> : <span className="help">You sign in with this.</span>}
              </label>
            </div>
            {emailChanged && !locked && (
              <label className="field">
                Current password
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  aria-invalid={!!errors.currentPassword || undefined}
                />
                {errors.currentPassword ? (
                  <span className="ferr">{errors.currentPassword}</span>
                ) : (
                  <span className="help">Needed to change the email you sign in with. Every other device is signed out.</span>
                )}
              </label>
            )}

            <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 16px", fontSize: 14 }}>
              <dt className="muted">Role</dt>
              <dd>{ROLE_LABEL[user.role]}</dd>
              <dt className="muted">{user.type === "staff" ? "Workspace" : "Company"}</dt>
              <dd>
                {user.type === "staff" ? "Halcyon Logistics Group" : user.client?.clientName ?? "–"}
                {user.client && <span className="muted mono"> · {user.client.clientId}</span>}
              </dd>
            </dl>

            {!locked && (
              <button
                className="btn btn-brand"
                type="submit"
                disabled={pending || (!nameChanged && !emailChanged)}
                aria-busy={pending}
                style={{ width: "max-content" }}
              >
                {pending && <Spinner />}
                {pending ? "Saving…" : "Save changes"}
              </button>
            )}
          </form>

          <section className="card" style={{ padding: 24, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h2 style={{ fontSize: 18, lineHeight: "28px" }}>Password</h2>
              <p className="muted" style={{ fontSize: 14, lineHeight: "20px" }}>
                Changing it signs you out on every other device.
              </p>
            </div>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={locked}
              onClick={() => setChangingPassword(true)}
            >
              <Icon name="lock-simple" />
              Change password
            </button>
          </section>
        </div>
        {user.role === "admin" && <DeliveryCutoffCard />}
      </div>

      <ChangePasswordDialog
        user={user}
        open={changingPassword}
        onClose={() => setChangingPassword(false)}
        onChanged={() => {
          setChangingPassword(false);
          toast.success("Password changed. You’re signed out everywhere else.");
        }}
      />
    </>
  );
}
