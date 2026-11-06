import { z } from "zod";
import type { FoundryConfig } from "../utils/foundry.js";
import type { GoogleOAuthConfig } from "../utils/gmail.js";
import type { MailerConfig } from "../utils/mailer.js";

const seconds = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(0).max(65535).default(4000),
    // Comma-separated list of allowed origins
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)),
    DATABASE_URL: z.string().trim().min(1, "DATABASE_URL is required"),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    ACCESS_TOKEN_TTL_SECONDS: seconds(15 * 60),
    REFRESH_TOKEN_TTL_SECONDS: seconds(7 * 24 * 60 * 60),
    COOKIE_SECURE: z.stringbool().default(true),
    COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
    COOKIE_DOMAIN: optionalString,
    // Number of reverse proxies in front of the app (1 on Azure App Service); drives req.ip.
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    // Optional Redis (e.g. Upstash, rediss://default:<token>@<host>:6379) that holds the login rate-limit counters,
    // so they are shared by every instance and survive restarts. Unset: counters live in each process's memory.
    REDIS_URL: optionalString.pipe(z.string().regex(/^rediss?:\/\//, "REDIS_URL must start with redis:// or rediss://").optional()),
    // Days to keep a session row after it expires (revoked rows expire too, at most REFRESH_TOKEN_TTL_SECONDS later).
    SESSION_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
    // Days to keep audit_log rows; 0 keeps them forever.
    AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).default(365),
    // Optional Gmail inbox poller: an OAuth client plus a refresh token (gmail.readonly) for the mailbox to read.
    // All three or none; with none the poller doesn't run.
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    GOOGLE_REFRESH_TOKEN: optionalString,
    EMAIL_POLL_INTERVAL_SECONDS: seconds(60),
    // Optional Foundry agent that reads each stored email. Both or none; with none, emails stay read_by_ai = false.
    FOUNDRY_PROJECT_ENDPOINT: optionalString,
    FOUNDRY_AGENT_NAME: optionalString,
    // Optional; without it the agent is called with DefaultAzureCredential.
    FOUNDRY_API_KEY: optionalString,
    // Optional second agent in the same Foundry project that drafts customer messages (out-of-stock notices). Without
    // it, those drafts come from a template.
    FOUNDRY_DRAFT_AGENT_NAME: optionalString,
    // Optional third agent in the same Foundry project that recommends carriers for the day's same-day orders once the
    // cutoff has passed. Without it there's no carrier plan.
    FOUNDRY_CARRIER_AGENT_NAME: optionalString,
    // Optional fourth agent in the same Foundry project that suggests stock transfers between warehouses (Inventory's
    // Rebalance). Without it there are no rebalance suggestions.
    FOUNDRY_ALLOCATION_IQ_AGENT_NAME: optionalString,
    // Days after staff apply a rebalance before the cartons reach the destination warehouse; 0 adds them at once. The
    // source loses them as soon as the transfer is applied either way. Default 0.
    STOCK_TRANSFER_DELAY_DAYS: z.coerce.number().int().min(0).max(30).default(0),
    // Optional SMTP server (nodemailer) for clients sending an order by email from the portal. It goes to ORDER_INBOX,
    // the mailbox the Gmail poller reads. SMTP_HOST and ORDER_INBOX together or neither; with neither the option is off.
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    // true for port 465 (TLS from the start); false upgrades with STARTTLS.
    SMTP_SECURE: z.stringbool().default(false),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    // Defaults to SMTP_USER.
    MAIL_FROM: optionalString,
    ORDER_INBOX: optionalString.pipe(z.email("ORDER_INBOX must be an email address").optional()),
    // false turns demo accounts off: none on the sign-in page, and they can't sign in.
    DEMO_MODE: z.stringbool().default(true),
  })
  .refine((env) => env.COOKIE_SAMESITE !== "none" || env.COOKIE_SECURE, {
    message: "COOKIE_SAMESITE=none requires COOKIE_SECURE=true",
    path: ["COOKIE_SAMESITE"],
  })
  .refine(
    (env) => new Set([env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REFRESH_TOKEN].map(Boolean)).size === 1,
    { message: "set all of GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN, or none", path: ["GOOGLE_CLIENT_ID"] },
  )
  .refine((env) => !env.FOUNDRY_PROJECT_ENDPOINT === !env.FOUNDRY_AGENT_NAME, {
    message: "set both FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_AGENT_NAME, or neither",
    path: ["FOUNDRY_PROJECT_ENDPOINT"],
  })
  .refine((env) => !env.FOUNDRY_DRAFT_AGENT_NAME || env.FOUNDRY_PROJECT_ENDPOINT, {
    message: "FOUNDRY_DRAFT_AGENT_NAME needs FOUNDRY_PROJECT_ENDPOINT",
    path: ["FOUNDRY_DRAFT_AGENT_NAME"],
  })
  .refine((env) => !env.FOUNDRY_CARRIER_AGENT_NAME || env.FOUNDRY_PROJECT_ENDPOINT, {
    message: "FOUNDRY_CARRIER_AGENT_NAME needs FOUNDRY_PROJECT_ENDPOINT",
    path: ["FOUNDRY_CARRIER_AGENT_NAME"],
  })
  .refine((env) => !env.FOUNDRY_ALLOCATION_IQ_AGENT_NAME || env.FOUNDRY_PROJECT_ENDPOINT, {
    message: "FOUNDRY_ALLOCATION_IQ_AGENT_NAME needs FOUNDRY_PROJECT_ENDPOINT",
    path: ["FOUNDRY_ALLOCATION_IQ_AGENT_NAME"],
  })
  .refine((env) => !env.SMTP_HOST === !env.ORDER_INBOX, {
    message: "set both SMTP_HOST and ORDER_INBOX, or neither",
    path: ["SMTP_HOST"],
  })
  .refine((env) => !env.SMTP_USER === !env.SMTP_PASS, {
    message: "set both SMTP_USER and SMTP_PASS, or neither",
    path: ["SMTP_USER"],
  })
  .refine((env) => !env.SMTP_HOST || env.MAIL_FROM || env.SMTP_USER, {
    message: "SMTP_HOST needs MAIL_FROM or SMTP_USER for the sender address",
    path: ["MAIL_FROM"],
  });

export type SameSite = "lax" | "strict" | "none";

export interface Config {
  nodeEnv: "development" | "test" | "production";
  port: number;
  corsOrigins: string[];
  databaseUrl: string;
  databasePoolMax: number;
  jwtSecret: string;
  accessTokenTtl: number;
  refreshTokenTtl: number;
  cookieSecure: boolean;
  cookieSameSite: SameSite;
  cookieDomain: string | undefined;
  trustProxy: number;
  redisUrl: string | undefined;
  sessionRetentionDays: number;
  auditRetentionDays: number;
  // null: the Gmail poller is off.
  emailPoller: { google: GoogleOAuthConfig; intervalSeconds: number } | null;
  // null: emails are not sent to the Foundry agent.
  foundry: FoundryConfig | null;
  // null: customer messages are drafted from a template.
  draftAgent: FoundryConfig | null;
  // null: no carrier plan is made.
  carrierAgent: FoundryConfig | null;
  // null: no rebalance suggestions.
  allocationAgent: FoundryConfig | null;
  // Days before an applied stock transfer reaches its destination; 0 is immediate.
  stockTransferDelayDays: number;
  // null: clients can't send orders by email from the portal.
  mailer: MailerConfig | null;
  // false: demo accounts are off.
  demoMode: boolean;
}

// Parses process.env once at startup and fails fast with every problem listed.
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    corsOrigins: env.CORS_ORIGINS,
    databaseUrl: env.DATABASE_URL,
    databasePoolMax: env.DATABASE_POOL_MAX,
    jwtSecret: env.JWT_SECRET,
    accessTokenTtl: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtl: env.REFRESH_TOKEN_TTL_SECONDS,
    cookieSecure: env.COOKIE_SECURE,
    cookieSameSite: env.COOKIE_SAMESITE,
    cookieDomain: env.COOKIE_DOMAIN,
    trustProxy: env.TRUST_PROXY,
    redisUrl: env.REDIS_URL,
    sessionRetentionDays: env.SESSION_RETENTION_DAYS,
    auditRetentionDays: env.AUDIT_RETENTION_DAYS,
    emailPoller:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN
        ? {
            google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, refreshToken: env.GOOGLE_REFRESH_TOKEN },
            intervalSeconds: env.EMAIL_POLL_INTERVAL_SECONDS,
          }
        : null,
    foundry:
      env.FOUNDRY_PROJECT_ENDPOINT && env.FOUNDRY_AGENT_NAME
        ? { endpoint: env.FOUNDRY_PROJECT_ENDPOINT, agentName: env.FOUNDRY_AGENT_NAME, apiKey: env.FOUNDRY_API_KEY }
        : null,
    draftAgent:
      env.FOUNDRY_PROJECT_ENDPOINT && env.FOUNDRY_DRAFT_AGENT_NAME
        ? { endpoint: env.FOUNDRY_PROJECT_ENDPOINT, agentName: env.FOUNDRY_DRAFT_AGENT_NAME, apiKey: env.FOUNDRY_API_KEY }
        : null,
    carrierAgent:
      env.FOUNDRY_PROJECT_ENDPOINT && env.FOUNDRY_CARRIER_AGENT_NAME
        ? { endpoint: env.FOUNDRY_PROJECT_ENDPOINT, agentName: env.FOUNDRY_CARRIER_AGENT_NAME, apiKey: env.FOUNDRY_API_KEY }
        : null,
    allocationAgent:
      env.FOUNDRY_PROJECT_ENDPOINT && env.FOUNDRY_ALLOCATION_IQ_AGENT_NAME
        ? { endpoint: env.FOUNDRY_PROJECT_ENDPOINT, agentName: env.FOUNDRY_ALLOCATION_IQ_AGENT_NAME, apiKey: env.FOUNDRY_API_KEY }
        : null,
    stockTransferDelayDays: env.STOCK_TRANSFER_DELAY_DAYS,
    demoMode: env.DEMO_MODE,
    mailer:
      env.SMTP_HOST && env.ORDER_INBOX
        ? {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
            from: (env.MAIL_FROM ?? env.SMTP_USER)!,
            orderInbox: env.ORDER_INBOX,
          }
        : null,
  };
}
