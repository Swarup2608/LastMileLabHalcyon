// Halcyon staff (admins and contributors): /api/staff, admin only.
import { request, segment, type StaffRole } from "./api";

export interface Staff {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  isActive: boolean;
  isDemo: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export const STAFF_ROLES: StaffRole[] = ["contributor", "admin"];

export const staffApi = {
  list: () => request<{ staff: Staff[] }>("/staff"),
  get: (id: string) => request<{ staff: Staff }>(`/staff/${segment(id)}`),
  // The API generates the starting password and returns it only here.
  create: (body: { email: string; name: string; role: StaffRole }) =>
    request<{ staff: Staff; temporaryPassword: string }>("/staff", { method: "POST", body }),
  update: (id: string, body: { name?: string; role?: StaffRole; isActive?: boolean; password?: string }) =>
    request<{ staff: Staff }>(`/staff/${segment(id)}`, { method: "PATCH", body }),
  // Either way the password is replaced; turning demo off returns the new one, once.
  setDemo: (id: string, isDemo: boolean) =>
    request<{ staff: Staff; temporaryPassword?: string }>(`/staff/${segment(id)}/demo`, { method: "PATCH", body: { isDemo } }),
};
