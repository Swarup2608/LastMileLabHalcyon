export type PrincipalType = "staff" | "client";
export type StaffRole = "admin" | "contributor";
export type Role = StaffRole | "client";

// Claims carried by the access token; available as req.auth on authenticated requests, where role and clientId are
// replaced by their current values from the database.
export interface AccessClaims {
  sub: string;
  typ: PrincipalType;
  role: Role;
  clientId?: string;
  // The session family the token was issued for; the token stops working once that family is revoked.
  sid: string;
  // Not in the token: set on req.auth from the database. A demo account's password is public, so it can't create or
  // promote admins (SEC-01).
  isDemo?: boolean;
}

export interface RefreshClaims {
  sub: string;
  typ: PrincipalType;
  jti: string;
}

// What the API returns for the signed-in user; never includes the password hash.
export interface Principal {
  type: PrincipalType;
  id: string;
  email: string;
  name: string;
  role: Role;
  // Demo accounts are listed on the sign-in page and can't change their own details.
  isDemo: boolean;
  client?: {
    clientId: string;
    clientName: string | null;
    region: string | null;
    accountTier: string | null;
    accountStatus: string | null;
  };
}
