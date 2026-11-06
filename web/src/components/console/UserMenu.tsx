"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import type { Principal, Role } from "@/lib/api";

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", contributor: "Contributor", client: "Client" };
const ROLE_TITLE: Record<Role, string> = {
  admin: "Administrator, Halcyon",
  contributor: "Operations, Halcyon",
  client: "Client",
};

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

// The avatar button and dropdown in the header, laid out like the console's: who you are, your workspace,
// Account settings, Simulation and Sign out. Closes on outside click and Escape.
export default function UserMenu({ user, onSignOut }: { user: Principal; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const company = user.client?.clientName;

  return (
    <div className="umenu-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        className="user"
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" style={{ background: user.type === "staff" ? "#0B6E77" : "#1D6FD1" }}>
          {initialsOf(user.name)}
        </span>
        <span className="who">
          {user.name}
          <span>{ROLE_LABEL[user.role]}</span>
        </span>
        <Icon name="caret-down" />
      </button>
      <div className="umenu" hidden={!open}>
        <div className="umenu-h">
          <strong>{user.name}</strong>
          {user.type === "client" && company ? company : ROLE_TITLE[user.role]}
        </div>
        <div className="umenu-h">
          {user.type === "staff" ? "Workspace" : "Account"}
          <strong>{user.type === "staff" ? "Halcyon Logistics Group" : company ?? "Client"}</strong>
        </div>
        <Link ref={firstItemRef} className="umenu-i" href="/portal/account" style={{ textDecoration: "none" }} onClick={() => setOpen(false)}>
          <Icon name="user-circle" />
          Account settings
        </Link>
        {user.role === "admin" && (
          <Link className="umenu-i" href="/portal/simulation" style={{ textDecoration: "none" }} onClick={() => setOpen(false)}>
            <Icon name="play" />
            Simulation
          </Link>
        )}
        <button className="umenu-i bad" type="button" onClick={onSignOut}>
          <Icon name="sign-out" />
          Sign out
        </button>
      </div>
    </div>
  );
}
