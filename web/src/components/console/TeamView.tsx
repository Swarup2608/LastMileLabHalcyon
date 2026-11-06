"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Icon from "@/components/Icon";
import Table from "@/components/Table";
import type { StaffRole } from "@/lib/api";
import { STAFF_ROLES, staffApi, type Staff } from "@/lib/staff";
import AddMemberDialog from "./AddMemberDialog";
import ConfirmDialog, { type ConfirmRequest } from "./ConfirmDialog";
import CredentialsDialog, { type Credentials } from "./CredentialsDialog";
import { useConsoleUser } from "./ConsoleShell";
import UsersTabs from "./UsersTabs";

const ROLE_LABEL: Record<StaffRole, string> = { admin: "Admin", contributor: "Contributor" };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never";

// Halcyon staff: everyone who can sign in to the operations console, filterable by role, status and name or email.
// New contributors and admins are added from a popup; the Demo switch lists a member on the sign-in page.
export default function TeamView() {
  const user = useConsoleUser();
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<"" | StaffRole>("");
  const [status, setStatus] = useState<"" | "active" | "inactive">("");
  const [adding, setAdding] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);

  const load = useCallback(async () => {
    try {
      setStaff((await staffApi.list()).staff);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading the list on mount is the point of this effect
    void load();
  }, [load]);

  // The team is small and /api/staff returns all of it, so filtering happens here.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (staff ?? []).filter(
      (m) =>
        (!role || m.role === role) &&
        (!status || (status === "active") === m.isActive) &&
        (!q || m.name.toLowerCase().includes(q) || m.email.includes(q)),
    );
  }, [staff, search, role, status]);

  const filtered = Boolean(search.trim() || role || status);

  // Demo on lists the member on the sign-in page with a fresh password anyone can use; demo off gives them another
  // fresh password, shown once. Either way their current password and sessions stop working. Asked in a popup first.
  function toggleDemo(member: Staff) {
    const turningOn = !member.isDemo;
    setConfirming({
      title: turningOn ? `Make ${member.name} a demo account?` : `Remove ${member.name} from the demo accounts?`,
      message: turningOn ? (
        <>
          <p>
            They’ll be listed on the sign-in page with a new password that anyone can use
            {member.role === "admin" ? <strong>, with full admin access</strong> : null}.
          </p>
          <p>Their current password stops working and they’re signed out everywhere.</p>
        </>
      ) : (
        <p>They get a new password, shown to you once, and the demo password stops working.</p>
      ),
      confirmLabel: turningOn ? "Make demo account" : "Remove from demo",
      danger: turningOn && member.role === "admin",
      action: async () => {
        const { staff: updated, temporaryPassword } = await staffApi.setDemo(member.id, turningOn);
        setStaff((list) => list?.map((m) => (m.id === updated.id ? updated : m)) ?? null);
        // Turning demo off hands over a new password in a popup; turning it on just needs confirming.
        if (!temporaryPassword) toast.success(`${updated.name} is now a demo account`);
        else {
          setCredentials({
            title: `${updated.name} is no longer a demo account`,
            message: "Send them these sign-in details; they can change the password after signing in.",
            email: updated.email,
            password: temporaryPassword,
          });
        }
      },
    });
  }

  return (
    <>
      <div className="page-h">
        <div>
          <p className="kick">Halcyon</p>
          <h1>Users</h1>
          <p>
            Staff: admins manage the team and client logins; contributors work the operations console
            {staff ? `. ${staff.length} ${staff.length === 1 ? "member" : "members"}` : ""}.
          </p>
        </div>
        <div className="acts">
          <button
            className="btn btn-brand"
            type="button"
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" />
            Add team member
          </button>
        </div>
      </div>

      <UsersTabs current="staff" />

      <section className="card" aria-label="Staff">
        <div className="toolbar">
          <select className="select" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as "" | StaffRole)}>
            <option value="">All roles</option>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | "active" | "inactive")}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Deactivated</option>
          </select>
          {filtered && (
            <button
              className="btn btn-quiet btn-sm"
              type="button"
              onClick={() => {
                setSearch("");
                setRole("");
                setStatus("");
              }}
            >
              Clear filters
            </button>
          )}
          <label className="searchbox">
            <span className="sr">Search team</span>
            <Icon name="magnifying-glass" />
            <input className="input" placeholder="Name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>

        {loadError ? (
          <div className="empty" role="alert">
            <Icon name="warning" className="lg" />
            We couldn’t load the team. Refresh the page to try again.
          </div>
        ) : !staff ? (
          <div className="empty" aria-busy="true">Loading team…</div>
        ) : (
          <Table
            label="Team"
            noun="members"
            rows={shown}
            rowKey={(m) => m.id}
            empty={
              <div className="empty">
                <Icon name="users" className="lg" />
                {filtered ? "No team members match these filters." : "No team members yet."}
              </div>
            }
            columns={[
              {
                key: "name",
                header: "Name",
                cell: (m) => (
                  <>
                    {m.name}
                    {m.id === user.id && <span className="muted"> (you)</span>}
                    <span className="sub">{m.email}</span>
                  </>
                ),
              },
              {
                key: "role",
                header: "Role",
                cell: (m) => <span className={`chip ${m.role === "admin" ? "pri" : "blue"}`}>{ROLE_LABEL[m.role]}</span>,
              },
              {
                key: "status",
                header: "Status",
                cell: (m) => <span className={`chip ${m.isActive ? "ok" : "bad"}`}>{m.isActive ? "Active" : "Deactivated"}</span>,
              },
              { key: "login", header: "Last sign-in", cellClass: () => "muted", cell: (m) => when(m.lastLoginAt) },
              { key: "added", header: "Added", cellClass: () => "muted", cell: (m) => when(m.createdAt) },
              {
                key: "demo",
                header: "Demo",
                cell: (m) => (
                  <button
                    className="switch"
                    type="button"
                    role="switch"
                    aria-checked={m.isDemo}
                    aria-label={`Demo account: ${m.name}`}
                    title={m.id === user.id ? "You can't make your own account a demo account" : "Listed on the sign-in page"}
                    disabled={m.id === user.id || !m.isActive}
                    onClick={() => toggleDemo(m)}
                  />
                ),
              },
            ]}
          />
        )}
      </section>

      <AddMemberDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(member, temporaryPassword) => {
          setAdding(false);
          setCredentials({
            title: `${member.name} added as ${ROLE_LABEL[member.role].toLowerCase()}`,
            message: "Send them these sign-in details. They sign in as Halcyon staff and change the password after.",
            email: member.email,
            password: temporaryPassword,
          });
          void load();
        }}
      />
      <ConfirmDialog request={confirming} onClose={() => setConfirming(null)} />
      <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />
    </>
  );
}
