import { SignJWT, jwtVerify } from "jose";
import type { AccessClaims, RefreshClaims, Role } from "../types/auth.js";

const ISSUER = "halcyon-api";
const ACCESS_AUDIENCE = "halcyon:access";
const REFRESH_AUDIENCE = "halcyon:refresh";
const ALGORITHM = "HS256";

const isPrincipalType = (value: unknown) => value === "staff" || value === "client";

// Signs and verifies both token kinds. The audience claim keeps a refresh token from being accepted as an
// access token and vice versa.
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly accessTtl: number,
    private readonly refreshTtl: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  signAccess({ sub, ...claims }: AccessClaims): Promise<string> {
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience(ACCESS_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtl}s`)
      .sign(this.key);
  }

  signRefresh({ sub, typ, jti }: RefreshClaims): Promise<string> {
    return new SignJWT({ typ })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(sub)
      .setJti(jti)
      .setIssuer(ISSUER)
      .setAudience(REFRESH_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.refreshTtl}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    const payload = await this.verify(token, ACCESS_AUDIENCE);
    if (!payload?.sub || !isPrincipalType(payload.typ) || typeof payload.role !== "string") return null;
    if (typeof payload.sid !== "string" || !payload.sid) return null;
    return {
      sub: payload.sub,
      typ: payload.typ as AccessClaims["typ"],
      role: payload.role as Role,
      clientId: typeof payload.clientId === "string" ? payload.clientId : undefined,
      sid: payload.sid,
    };
  }

  async verifyRefresh(token: string): Promise<RefreshClaims | null> {
    const payload = await this.verify(token, REFRESH_AUDIENCE);
    if (!payload?.sub || !payload.jti || !isPrincipalType(payload.typ)) return null;
    return { sub: payload.sub, typ: payload.typ as RefreshClaims["typ"], jti: payload.jti };
  }

  private async verify(token: string, audience: string) {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience, algorithms: [ALGORITHM] });
      return payload;
    } catch {
      return null;
    }
  }
}
