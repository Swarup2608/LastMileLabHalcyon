import type { Request, Response } from "express";
import type { SettingsRepository } from "../repositories/settings.repository.js";
import type { DeliveryRuleBody } from "../schemas/settings.schema.js";
import type { AuditService } from "../services/audit.service.js";

export class SettingsController {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly audit: AuditService,
  ) {}

  get = async (_req: Request, res: Response) => {
    res.json({ delivery: await this.settings.deliveryRule() });
  };

  setDelivery = async (req: Request<Record<string, string>, unknown, DeliveryRuleBody>, res: Response) => {
    await this.settings.setDeliveryRule(req.body, req.auth!.sub);
    await this.audit.record(req, { action: "settings.delivery.update", targetType: "settings", targetId: "delivery", details: { ...req.body } });
    res.json({ delivery: await this.settings.deliveryRule() });
  };
}
