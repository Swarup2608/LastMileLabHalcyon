import type { Request, Response } from "express";
import type { ListMarketplaceQuery, MarketplaceOrderBody } from "../schemas/marketplace.schema.js";
import { actorOf, type AuditService } from "../services/audit.service.js";
import type { AuthService } from "../services/auth.service.js";
import type { MarketplaceService } from "../services/marketplace.service.js";
import type { CookieService } from "../utils/cookies.js";

export class MarketplaceController {
  constructor(
    private readonly marketplace: MarketplaceService,
    private readonly auth: AuthService,
    private readonly cookies: CookieService,
    private readonly audit: AuditService,
  ) {}

  list = async (req: Request, res: Response) => {
    res.json(await this.marketplace.list(req.query as unknown as ListMarketplaceQuery));
  };

  // Signs the buyer in afterwards with the password they just chose, so the order page opens straight away.
  placeOrder = async (req: Request<Record<string, string>, unknown, MarketplaceOrderBody>, res: Response) => {
    const { contact, companyName } = req.body;
    const { user: _created, ...placed } = await this.marketplace.placeOrder(req.body);
    const session = await this.auth.login("client", contact.email, contact.password, { userAgent: req.get("user-agent"), ip: req.ip });
    await this.audit.record(req, {
      actor: actorOf(session.user),
      action: "marketplace.order",
      targetType: "order_request",
      targetId: placed.id,
      details: { clientId: placed.client.clientId, companyName, contactEmail: contact.email, lines: req.body.order.lines.length },
    });
    this.cookies.setAuth(res, session.accessToken, session.refreshToken);
    res.set("Cache-Control", "no-store");
    res.status(201).json({ ...placed, accessTokenExpiresAt: session.accessTokenExpiresAt });
  };
}
