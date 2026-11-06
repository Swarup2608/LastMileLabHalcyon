import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import argon2 from "argon2";

// argon2id with the library defaults (64 MiB, 3 passes, 4 lanes), above the OWASP minimum. The parameters are stored
// in the hash, so they can be raised later; needsRehash() then upgrades each account on its next sign-in.
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

// A throwaway hash, so a missing account costs the same time as a wrong password and timing can't reveal which emails
// exist.
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(password: string, passwordHash: string | undefined): Promise<boolean> {
  try {
    if (passwordHash === undefined) {
      dummyHash ??= hashPassword(randomBytes(32).toString("hex"));
      await argon2.verify(await dummyHash, password);
      return false;
    }
    if (passwordHash.startsWith("scrypt$")) return await verifyLegacyScrypt(password, passwordHash);
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

// True for a hash that should be replaced after a successful sign-in: an older scrypt hash, or argon2 with weaker
// parameters than hashPassword uses today.
export function needsRehash(passwordHash: string): boolean {
  if (passwordHash.startsWith("scrypt$")) return true;
  try {
    return argon2.needsRehash(passwordHash);
  } catch {
    return true;
  }
}

// Hashes made before the switch to argon2 (scrypt$N$r$p$salt$hash). Only verified, never created; each is replaced by
// an argon2id hash on the account's next sign-in.
const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );

async function verifyLegacyScrypt(password: string, stored: string): Promise<boolean> {
  const [, n, r, p, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(key, expected);
}

// No look-alikes (0/O, 1/l/I), so a password read off a screen or message is typed right the first time.
const READABLE = "abcdefghjkmnpqrstuvwxyz23456789";

// A starting password for a new account, e.g. "k7mq-x2vd-9pwa-h4tn": 16 random characters (~79 bits), always with a
// letter and a number so it meets the password rules. The owner replaces it from their account page.
export function generatePassword(): string {
  for (;;) {
    const bytes = randomBytes(16);
    // 256 % 31 leaves a tiny bias; at this length it doesn't matter.
    const chars = Array.from(bytes, (b) => READABLE[b % READABLE.length]);
    const password = [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
    if (/[a-z]/.test(password) && /[0-9]/.test(password)) return password;
  }
}
