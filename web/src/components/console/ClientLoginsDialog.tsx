"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import Table from "@/components/Table";
import { ApiError } from "@/lib/api";
import { clientsApi, type Client, type ClientUser } from "@/lib/clients";
import ConfirmDialog, { type ConfirmRequest } from "./ConfirmDialog";
import CredentialsDialog, { type Credentials } from "./CredentialsDialog";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never";

// Popup listing one client's logins, where an admin marks a login as a demo account for the sign-in page.
// Render it with key={client.clientId} so each client starts from a clean state.
export default function ClientLoginsDialog({ client, onClose }: { client: Client; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [users, setUsers] = useState<ClientUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  useEffect(() => {
    ref.current?.showModal();
    let active = true;
    clientsApi.listUsers(client.clientId).then(
      ({ users: list }) => active && setUsers(list),
      (err) =>
        active &&
        setLoadError(err instanceof ApiError ? `We couldn’t load this client’s logins: ${err.message}` : "We couldn’t reach Halcyon."),
    );
    return () => {
      active = false;
    };
  }, [client.clientId]);

  function toggleDemo(user: ClientUser) {
    const turningOn = !user.isDemo;
    setConfirming({
      title: turningOn ? `Make ${user.name} a demo account?` : `Remove ${user.name} from the demo accounts?`,
      message: turningOn ? (
        <>
          <p>
            They’ll be listed on the sign-in page with a new password that anyone can use to see{" "}
            {client.clientName ?? "this client"}’s data.
          </p>
          <p>Their current password stops working and they’re signed out everywhere.</p>
        </>
      ) : (
        <p>They get a new password, shown to you once, and the demo password stops working.</p>
      ),
      confirmLabel: turningOn ? "Make demo account" : "Remove from demo",
      action: async () => {
        const { user: updated, temporaryPassword } = await clientsApi.setUserDemo(client.clientId, user.id, turningOn);
        setUsers((list) => list?.map((u) => (u.id === updated.id ? updated : u)) ?? null);
        if (temporaryPassword) {
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
      <dialog
        ref={ref}
        className="dlg"
        aria-labelledby="logins-title"
        onClose={onClose}
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
        style={{ width: "min(720px, calc(100vw - 32px))" }}
      >
        <div className="dlg-b">
          <div>
            <h2 id="logins-title">{client.clientName ?? client.clientId} logins</h2>
            <p className="muted" style={{ fontSize: 14, lineHeight: "20px", marginTop: 4 }}>
              <span className="mono">{client.clientId}</span> · Turn on Demo to list a login on the sign-in page.
            </p>
          </div>

          {loadError ? (
            <p className="callout bad" role="alert">{loadError}</p>
          ) : !users ? (
            <div className="empty" aria-busy="true">
              <span className="spinner" aria-hidden="true" />
              Loading logins…
            </div>
          ) : (
            <Table
              label="Client logins"
              noun="logins"
              rows={users}
              rowKey={(u) => u.id}
              empty={
                <div className="empty">
                  <Icon name="users" className="lg" />
                  This client has no logins yet.
                </div>
              }
              columns={[
                {
                  key: "name",
                  header: "Name",
                  cell: (u) => (
                    <>
                      {u.name}
                      <span className="sub">{u.email}</span>
                    </>
                  ),
                },
                {
                  key: "status",
                  header: "Status",
                  cell: (u) => <span className={`chip ${u.isActive ? "ok" : "bad"}`}>{u.isActive ? "Active" : "Deactivated"}</span>,
                },
                { key: "login", header: "Last sign-in", cellClass: () => "muted", cell: (u) => when(u.lastLoginAt) },
                {
                  key: "demo",
                  header: "Demo",
                  cell: (u) => (
                    <button
                      className="switch"
                      type="button"
                      role="switch"
                      aria-checked={u.isDemo}
                      aria-label={`Demo account: ${u.name}`}
                      disabled={!u.isActive}
                      onClick={() => toggleDemo(u)}
                    />
                  ),
                },
              ]}
            />
          )}

          <div className="dlg-acts">
            <button className="btn btn-secondary" type="button" onClick={() => ref.current?.close()}>
              Close
            </button>
          </div>
        </div>
      </dialog>
      <ConfirmDialog request={confirming} onClose={() => setConfirming(null)} />
      <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />
    </>
  );
}
