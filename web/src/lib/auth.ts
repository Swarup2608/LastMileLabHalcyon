"use client";

import { useEffect, useState } from "react";
import { ApiError, onUnauthorized, request, type Principal, type Realm, type Role } from "./api";

export interface AuthResponse {
  user: Principal;
  accessTokenExpiresAt: string;
}

// A login an admin marked as demo: shown on the sign-in page and signed in with the normal login call.
export interface DemoAccount {
  realm: Realm;
  name: string;
  email: string;
  password: string;
  role: Role;
  clientName: string | null;
}

export interface AccountChanges {
  name?: string;
  email?: string;
  newPassword?: string;
  // Needed for a new email or password, not for the name.
  currentPassword?: string;
}

// /api/auth/<realm>/*. The API sets and clears the session cookies on these routes.
export const authApi = {
  login: (realm: Realm, email: string, password: string) =>
    request<AuthResponse>(`/auth/${realm}/login`, { method: "POST", body: { email, password }, noRefresh: true }),
  refresh: (realm: Realm) => request<AuthResponse>(`/auth/${realm}/refresh`, { method: "POST", noRefresh: true }),
  logout: (realm: Realm) => request<void>(`/auth/${realm}/logout`, { method: "POST", noRefresh: true }),
  logoutAll: (realm: Realm) => request<void>(`/auth/${realm}/logout-all`, { method: "POST" }),
  me: (realm: Realm) => request<{ user: Principal }>(`/auth/${realm}/me`),
  // A new email or password also replaces this browser's session cookies (every other session is ended).
  updateAccount: (realm: Realm, body: AccountChanges) =>
    request<{ user: Principal }>(`/auth/${realm}/me`, { method: "PATCH", body }),
  demoAccounts: () => request<{ accounts: DemoAccount[] }>("/auth/demo-accounts", { noRefresh: true }),
};

// Which realm (client or staff) the current session belongs to. The tokens themselves are httpOnly cookies the page
// can't see, so this is only a hint for which /api/auth/<realm>/* routes to call; the API still checks every token.
const REALM_KEY = "halcyon.realm";

function readRealm(): Realm | null {
  try {
    const value = localStorage.getItem(REALM_KEY);
    return value === "client" || value === "staff" ? value : null;
  } catch {
    return null;
  }
}

function writeRealm(realm: Realm | null) {
  try {
    if (realm) localStorage.setItem(REALM_KEY, realm);
    else localStorage.removeItem(REALM_KEY);
  } catch {}
}

// Concurrent 401s share one refresh, so the refresh token is rotated only once.
let refreshing: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  const realm = readRealm();
  if (!realm) return Promise.resolve(false);
  if (!refreshing) {
    refreshing = authApi
      .refresh(realm)
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

onUnauthorized(refreshSession);

export async function signIn(realm: Realm, email: string, password: string): Promise<Principal> {
  const { user } = await authApi.login(realm, email, password);
  writeRealm(realm);
  return user;
}

export async function signOut(): Promise<void> {
  const realm = readRealm();
  writeRealm(null);
  // Logout always clears the cookies server side; a network failure still leaves this browser signed out locally.
  if (realm) await authApi.logout(realm).catch(() => undefined);
}

// Updates the signed-in user's own account; the API checks the current password for a new email or password.
export async function updateAccount(user: Principal, changes: AccountChanges): Promise<Principal> {
  return (await authApi.updateAccount(user.type, changes)).user;
}

// The signed-in user, renewing an expired access token on the way; null when there is no live session.
export async function getSession(): Promise<Principal | null> {
  const realm = readRealm();
  if (!realm) return null;
  try {
    return (await authApi.me(realm)).user;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      writeRealm(null);
      return null;
    }
    throw err;
  }
}

export const isStaff = (user: Principal) => user.type === "staff";
export const isAdmin = (user: Principal) => user.role === "admin";

export type SessionState =
  | { status: "loading"; user: null }
  | { status: "authenticated"; user: Principal }
  | { status: "unauthenticated"; user: null };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading", user: null });

  useEffect(() => {
    let active = true;
    getSession()
      .catch(() => null)
      .then((user) => {
        if (active) setState(user ? { status: "authenticated", user } : { status: "unauthenticated", user: null });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
