import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import type { Container } from "./container.js";
import { auditDenied } from "./middleware/audit-denied.js";
import { authenticate } from "./middleware/authenticate.js";
import { verifyOrigin } from "./middleware/csrf.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { healthRoutes, type HealthState } from "./routes/health.routes.js";
import { apiRoutes } from "./routes/index.js";

export function createApp(container: Container, state: HealthState = { shuttingDown: false }) {
  const { config, db, tokens, repositories, services } = container;
  const app = express();

  app.disable("x-powered-by");
  // Behind Azure App Service's front end; needed so req.ip (rate limiting, session audit) is the real client.
  app.set("trust proxy", config.trustProxy);

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(verifyOrigin(config.corsOrigins));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(authenticate(tokens, repositories.sessions));

  app.use(healthRoutes(db, state));
  // API responses carry personal data, generated passwords and session state: no browser or proxy may cache them.
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", auditDenied(services.audit));
  app.use("/api", apiRoutes(container));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
