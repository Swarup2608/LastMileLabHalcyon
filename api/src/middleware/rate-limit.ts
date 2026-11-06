import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import type { Request } from "express";

// Azure App Service writes the client port into X-Forwarded-For ("1.2.3.4:56789", "[::1]:443"); left in, every
// connection would get its own counter. The port is dropped and IPv6 addresses are grouped by subnet.
export function clientIpKey(ip: string | undefined) {
  const raw = ip ?? "";
  const address = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(raw)?.[1] ?? /^\[([0-9a-f:.]+)\](?::\d+)?$/i.exec(raw)?.[1] ?? raw;
  return ipKeyGenerator(address);
}

// The account a password guess is aimed at: the signed-in user on PATCH /me, else the email in the login body.
function accountKey(req: Request) {
  if (req.auth) return `id:${req.auth.sub}`;
  const email: unknown = req.body?.email;
  return typeof email === "string" && email.trim() ? `email:${email.trim().toLowerCase()}` : undefined;
}

// Counts wrong passwords only: 401 from login, 403 from a wrong current password on the account endpoint. Typos in a
// form (400) and successes never count, so nobody is locked out for anything but guessing. Without a store each call
// makes its own in-memory counter, so every app instance (and every test app) starts clean; with the Redis store the
// counters are shared by every instance and survive restarts.
const failedPasswordLimit = (store: Store | undefined, key: (req: Request) => string | undefined) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    keyGenerator: (req) => key(req)!,
    // No key (a login body without an email): validation answers 400, which never counts anyway.
    skip: (req) => key(req) === undefined,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401 && res.statusCode !== 403,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Try again later." },
    store,
    // If Redis is unreachable, let sign-in through (the error is logged) rather than lock everyone out.
    passOnStoreError: Boolean(store),
    // req.ip may still carry Azure's port; clientIpKey normalises it, so the raw-IP check would only add noise.
    validate: { ip: false },
  });

const ipKey = (req: Request) => clientIpKey(req.ip);

// Accounts created from one IP through the public marketplace, whether or not the attempt succeeds, so it also slows
// anyone testing which emails already have a login.
export const signupRateLimit = (store?: Store) =>
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    keyGenerator: ipKey,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many new accounts from this connection. Try again later." },
    store,
    passOnStoreError: Boolean(store),
    // clientIpKey already groups IPv6 addresses with ipKeyGenerator.
    validate: { ip: false, keyGeneratorIpFallback: false },
  });

// Per client IP: slows one source guessing many accounts.
export const loginRateLimit = (store?: Store) => failedPasswordLimit(store, (req) => clientIpKey(req.ip));

// Per target account: slows many sources (a botnet, or users sharing a proxy IP) guessing one account. The email
// isn't checked for existence, so the limit applies the same to unknown emails and reveals nothing.
export const accountRateLimit = (store?: Store) => failedPasswordLimit(store, accountKey);
