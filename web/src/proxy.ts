import { NextResponse, type NextRequest } from "next/server";
import type { Role } from "@/lib/api";

// Server-side route guard for the portal: the page itself (and the admin screens' code) is only served to a signed-in
// user whose role may open it. The API still checks every request; this keeps anonymous visitors and the wrong roles
// from loading screens they can't use. Keep ROUTES in step with each page's <RoleGate roles>.

const ACCESS_COOKIE = "halcyon_at";
const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

const ALL: Role[] = ["admin", "contributor", "client"];
const STAFF: Role[] = ["admin", "contributor"];

// Most specific first; anything else under /portal needs only a signed-in user.
const ROUTES: [prefix: string, roles: Role[]][] = [
  ["/portal/clients/new", ["admin"]],
  ["/portal/orders/new", ["client"]],
  ["/portal/team", ["admin"]],
  ["/portal/clients", STAFF],
  ["/portal/exceptions", STAFF],
  ["/portal/emails", STAFF],
  ["/portal/inventory", STAFF],
  ["/portal/carriers", STAFF],
  ["/portal/rules", ["admin"]],
  ["/portal/simulation", ["admin"]],
  ["/portal/products", ["client"]],
  ["/portal/messages", ["client"]],
];

const rolesFor = (path: string) =>
  ROUTES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? ALL;

// Asks the API whose access token this is. A client token is refused (403) by the staff realm's /me, which is
// enough to know it's a client; anything else (expired, revoked, API unreachable) counts as signed out.
async function roleOf(token: string): Promise<Role | null> {
  try {
    const res = await fetch(`${API_URL}/api/auth/staff/me`, {
      headers: { cookie: `${ACCESS_COOKIE}=${token}`, accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 403) return "client";
    if (!res.ok) return null;
    const { user } = (await res.json()) as { user?: { role?: Role } };
    return user?.role ?? null;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  const role = token ? await roleOf(token) : null;

  // No live access token: the sign-in page renews it from the refresh cookie when it can and comes straight back.
  if (!role) {
    const signin = new URL("/signin", request.url);
    signin.searchParams.set("next", pathname);
    return NextResponse.redirect(signin);
  }
  if (!rolesFor(pathname).includes(role)) return NextResponse.redirect(new URL("/portal", request.url));

  const res = NextResponse.next();
  // Pages behind sign-in are per user; never cache them.
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export const config = {
  matcher: ["/portal", "/portal/:path*"],
};
