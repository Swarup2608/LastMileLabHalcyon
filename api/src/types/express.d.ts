import type { AccessClaims } from "./auth.js";

declare module "express-serve-static-core" {
  interface Request {
    // Set by the authenticate middleware when the access-token cookie is valid.
    auth?: AccessClaims;
  }
}
