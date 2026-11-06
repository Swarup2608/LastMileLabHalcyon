import type { Redis } from "ioredis";
import type { Pool } from "pg";
import type { Config } from "./config/env.js";
import { AuditController } from "./controllers/audit.controller.js";
import { AuthController, DemoAccountsController } from "./controllers/auth.controller.js";
import { CarrierPlanController } from "./controllers/carrier-plan.controller.js";
import { ClientsController } from "./controllers/clients.controller.js";
import { EmailsController } from "./controllers/emails.controller.js";
import { MarketplaceController } from "./controllers/marketplace.controller.js";
import { ProductsController } from "./controllers/products.controller.js";
import { RebalanceController } from "./controllers/rebalance.controller.js";
import { SettingsController } from "./controllers/settings.controller.js";
import { SimulationController } from "./controllers/simulation.controller.js";
import { StaffController } from "./controllers/staff.controller.js";
import { StockoutsController } from "./controllers/stockouts.controller.js";
import { WarehousesController } from "./controllers/warehouses.controller.js";
import { RedisRateLimitStore } from "./middleware/redis-rate-limit-store.js";
import { AuditRepository } from "./repositories/audit.repository.js";
import { CarrierPlanRepository } from "./repositories/carrier-plan.repository.js";
import { ClientUserRepository } from "./repositories/client-user.repository.js";
import { ClientRepository } from "./repositories/client.repository.js";
import { EmailRepository } from "./repositories/email.repository.js";
import { ProductRepository } from "./repositories/product.repository.js";
import { SessionRepository } from "./repositories/session.repository.js";
import { SettingsRepository } from "./repositories/settings.repository.js";
import { StaffRepository } from "./repositories/staff.repository.js";
import { StockTransferRepository } from "./repositories/stock-transfer.repository.js";
import { StockoutRepository } from "./repositories/stockout.repository.js";
import { WarehouseRepository } from "./repositories/warehouse.repository.js";
import { AuditService } from "./services/audit.service.js";
import { AuthService } from "./services/auth.service.js";
import { CarrierPlanService } from "./services/carrier-plan.service.js";
import { ClientsService } from "./services/clients.service.js";
import { EmailAgentService } from "./services/email-agent.service.js";
import { EmailPollerService } from "./services/email-poller.service.js";
import { MarketplaceService } from "./services/marketplace.service.js";
import { ProductsService } from "./services/products.service.js";
import { RebalanceService } from "./services/rebalance.service.js";
import { RetentionService } from "./services/retention.service.js";
import { StaffService } from "./services/staff.service.js";
import { StockMessageService } from "./services/stock-message.service.js";
import { StockTransferService } from "./services/stock-transfer.service.js";
import { StockoutService } from "./services/stockout.service.js";
import { WarehousesService } from "./services/warehouses.service.js";
import { CookieService } from "./utils/cookies.js";
import { createFoundryAgent } from "./utils/foundry.js";
import { createGmailSource } from "./utils/gmail.js";
import { TokenService } from "./utils/jwt.js";
import { createMailer } from "./utils/mailer.js";

// Composition root: builds repositories -> services -> controllers once and hands them down explicitly.
// redis is optional: without it the login rate limiter keeps its counters in memory.
export function createContainer(config: Config, db: Pool, redis?: Redis) {
  const repositories = {
    staff: new StaffRepository(db),
    clients: new ClientRepository(db),
    clientUsers: new ClientUserRepository(db),
    sessions: new SessionRepository(db, config.refreshTokenTtl),
    warehouses: new WarehouseRepository(db),
    products: new ProductRepository(db),
    audit: new AuditRepository(db),
    emails: new EmailRepository(db),
    settings: new SettingsRepository(db),
    carrierPlans: new CarrierPlanRepository(db),
    stockouts: new StockoutRepository(db),
    stockTransfers: new StockTransferRepository(db),
  };

  const tokens = new TokenService(config.jwtSecret, config.accessTokenTtl, config.refreshTokenTtl);
  const cookies = new CookieService(config);

  // Shared by the stock-out log routes, saving a request's routing, and the rebalance input.
  const stockouts = new StockoutService(
    repositories.stockouts,
    repositories.emails,
    repositories.products,
    repositories.warehouses,
    repositories.settings,
  );

  const clients = new ClientsService(db, repositories.clients, repositories.clientUsers, repositories.sessions, config.demoMode);
  const services = {
    stockouts,
    stockTransfers: new StockTransferService(db, repositories.stockTransfers, config.stockTransferDelayDays),
    auth: new AuthService(config, repositories.staff, repositories.clientUsers, repositories.sessions, tokens, repositories.audit),
    staff: new StaffService(repositories.staff, repositories.sessions, config.demoMode),
    clients,
    marketplace: new MarketplaceService(db, repositories.products, clients, repositories.settings),
    warehouses: new WarehousesService(repositories.warehouses),
    products: new ProductsService(repositories.products),
    audit: new AuditService(repositories.audit),
    retention: new RetentionService(repositories.sessions, repositories.audit, config),
    // Only when GOOGLE_* are set.
    emailPoller: config.emailPoller
      ? new EmailPollerService(createGmailSource(config.emailPoller.google), repositories.emails)
      : undefined,
    // Only when FOUNDRY_* are set.
    emailAgent: config.foundry ? new EmailAgentService(createFoundryAgent(config.foundry), repositories.emails) : undefined,
    // The template when FOUNDRY_DRAFT_AGENT_NAME isn't set.
    stockMessages: new StockMessageService(config.draftAgent ? createFoundryAgent(config.draftAgent) : undefined),
    // Off (no plans, only the monthly carrier figures) when FOUNDRY_CARRIER_AGENT_NAME isn't set.
    carrierPlan: new CarrierPlanService(
      repositories.carrierPlans,
      repositories.emails,
      repositories.warehouses,
      repositories.settings,
      config.carrierAgent ? createFoundryAgent(config.carrierAgent) : undefined,
      config.carrierAgent?.agentName,
    ),
    // Off (503) when FOUNDRY_ALLOCATION_IQ_AGENT_NAME isn't set.
    rebalance: new RebalanceService(
      repositories.products,
      repositories.warehouses,
      stockouts,
      repositories.stockTransfers,
      config.allocationAgent ? createFoundryAgent(config.allocationAgent) : undefined,
    ),
  };

  const controllers = {
    clientAuth: new AuthController("client", services.auth, cookies, services.audit),
    staffAuth: new AuthController("staff", services.auth, cookies, services.audit),
    demoAccounts: new DemoAccountsController(services.auth),
    staff: new StaffController(services.staff, services.audit),
    clients: new ClientsController(services.clients, services.audit),
    warehouses: new WarehousesController(services.warehouses),
    products: new ProductsController(services.products),
    marketplace: new MarketplaceController(services.marketplace, services.auth, cookies, services.audit),
    audit: new AuditController(services.audit),
    emails: new EmailsController(
      repositories.emails,
      services.audit,
      repositories.settings,
      services.stockMessages,
      services.stockouts,
      services.emailAgent,
      // Only when SMTP_HOST / ORDER_INBOX are set.
      config.mailer ? createMailer(config.mailer) : undefined,
    ),
    settings: new SettingsController(repositories.settings, services.audit),
    carrierPlan: new CarrierPlanController(services.carrierPlan, repositories.carrierPlans, services.audit),
    rebalance: new RebalanceController(
      services.rebalance,
      services.stockTransfers,
      repositories.stockTransfers,
      repositories.warehouses,
      services.audit,
    ),
    stockouts: new StockoutsController(services.stockouts),
    simulation: new SimulationController(services.carrierPlan, services.rebalance, services.emailAgent),
  };

  // Prefixed by environment so dev and production can share one Upstash database without sharing counters. Each
  // limiter needs a store of its own.
  const rateLimitStores = redis
    ? {
        ip: new RedisRateLimitStore(redis, `halcyon:${config.nodeEnv}:login:`),
        account: new RedisRateLimitStore(redis, `halcyon:${config.nodeEnv}:login-account:`),
        signup: new RedisRateLimitStore(redis, `halcyon:${config.nodeEnv}:signup:`),
      }
    : undefined;

  return { config, db, tokens, repositories, services, controllers, rateLimitStores };
}

export type Container = ReturnType<typeof createContainer>;
