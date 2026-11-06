// Client companies and their logins: /api/clients.
import { request, segment } from "./api";

export interface Client {
  clientId: string;
  clientName: string | null;
  region: string | null;
  primaryOrderChannel: string | null;
  accountTier: string | null;
  slaPenaltyClause: boolean;
  annualRevenueUsd: number | null;
  accountStatus: string | null;
}

export interface ClientList {
  clients: Client[];
  total: number;
  limit: number;
  offset: number;
}

export interface ClientUser {
  id: string;
  clientId: string;
  email: string;
  name: string;
  isActive: boolean;
  isDemo: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

// The values the client dataset uses; the API rejects anything else on sign-up.
export const CLIENT_REGIONS = ["Midwest", "Northeast", "Southeast", "West"] as const;
export const ORDER_CHANNELS = ["Email", "EDI", "API"] as const;
export const ACCOUNT_TIERS = ["Tier 1", "Tier 2", "Tier 3"] as const;
export const ACCOUNT_STATUSES = ["active", "threatening_to_leave"] as const;

export interface ClientSignup {
  clientName: string;
  region: (typeof CLIENT_REGIONS)[number];
  primaryOrderChannel: (typeof ORDER_CHANNELS)[number];
  accountTier: (typeof ACCOUNT_TIERS)[number];
  slaPenaltyClause?: boolean;
  annualRevenueUsd?: number | null;
  // The first login; the contact changes this email and password themselves after signing in.
  contact: { name: string; email: string; password: string };
}

export interface ClientFilters {
  q?: string;
  region?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export const clientsApi = {
  list: (filters: ClientFilters = {}) => request<ClientList>("/clients", { query: { ...filters } }),
  get: (clientId: string) => request<{ client: Client }>(`/clients/${segment(clientId)}`),
  // Admin only: creates the company and its first login together.
  signup: (body: ClientSignup) => request<{ client: Client; user: ClientUser }>("/clients", { method: "POST", body }),
  listUsers: (clientId: string) => request<{ users: ClientUser[] }>(`/clients/${segment(clientId)}/users`),
  createUser: (clientId: string, body: { email: string; name: string; password: string }) =>
    request<{ user: ClientUser }>(`/clients/${segment(clientId)}/users`, { method: "POST", body }),
  updateUser: (clientId: string, userId: string, body: { name?: string; isActive?: boolean; password?: string }) =>
    request<{ user: ClientUser }>(`/clients/${segment(clientId)}/users/${segment(userId)}`, { method: "PATCH", body }),
  // Either way the password is replaced; turning demo off returns the new one, once.
  setUserDemo: (clientId: string, userId: string, isDemo: boolean) =>
    request<{ user: ClientUser; temporaryPassword?: string }>(
      `/clients/${segment(clientId)}/users/${segment(userId)}/demo`,
      { method: "PATCH", body: { isDemo } },
    ),
};
