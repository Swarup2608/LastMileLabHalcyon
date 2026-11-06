// HTTP core for the Halcyon API (api/). Requests go to same-origin /api/*, which app/api/[...path]/route.ts forwards
// to the API server; the access and refresh tokens travel only as httpOnly cookies, never through this code.
// The endpoints live with their domain, mirroring the API's routes: auth.ts, clients.ts, staff.ts, warehouses.ts.

export type Realm = "client" | "staff";
export type StaffRole = "admin" | "contributor";
export type Role = StaffRole | "client";

// The signed-in user, as returned by login, refresh and /me.
export interface Principal {
  type: Realm;
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

// One zod issue from a 400, as listed in ApiError.details.
export interface FieldIssue {
  location: string;
  path: string;
  message: string;
}

// The API answers every failure with { error, details? }.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  // Validation messages keyed by body field ("contact.email"), for showing next to each input.
  fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const issue of this.details as FieldIssue[]) errors[issue.path] ??= issue.message;
    }
    return errors;
  }

  // What was actually wrong, for a toast: the validation messages, or the error itself when there are none.
  reasons() {
    const messages = Array.isArray(this.details) ? (this.details as FieldIssue[]).map((issue) => issue.message) : [];
    return messages.length ? [...new Set(messages)].join(". ") : this.message;
  }

  // Messages for the fields a form shows; anything else lands under "form", so no error is ever dropped silently.
  errorsFor(fields: string[]): Record<string, string> {
    const all = this.fieldErrors();
    const errors: Record<string, string> = {};
    const other: string[] = [];
    for (const [path, message] of Object.entries(all)) {
      if (fields.includes(path)) errors[path] = message;
      else other.push(path ? `${path}: ${message}` : message);
    }
    if (other.length || !Object.keys(errors).length) errors.form = other.length ? other.join(". ") : this.message;
    return errors;
  }
}

type Query = Record<string, string | number | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  body?: unknown;
  query?: Query;
  // Set on the auth routes themselves, so a 401 there is reported instead of triggering a refresh.
  noRefresh?: boolean;
}

// Installed by auth.ts: renews the session once a request comes back 401, resolving true when it worked.
let refreshHandler: (() => Promise<boolean>) | null = null;
export const onUnauthorized = (handler: () => Promise<boolean>) => {
  refreshHandler = handler;
};

export const segment = (value: string) => encodeURIComponent(value);

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function send(path: string, { method = "GET", body, query }: RequestOptions) {
  return fetch(withQuery(`/api${path}`, query), {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await send(path, options);
  // The access token lives 15 minutes; renew it from the refresh cookie and retry once.
  if (res.status === 401 && !options.noRefresh && refreshHandler && (await refreshHandler())) {
    res = await send(path, options);
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = typeof data?.error === "string" ? data.error : res.statusText || "Request failed";
    throw new ApiError(res.status, message, data?.details);
  }
  return data as T;
}
