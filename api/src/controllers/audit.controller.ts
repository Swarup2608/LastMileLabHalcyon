import type { Request, Response } from "express";
import type { AuditListQuery } from "../schemas/audit.schema.js";
import type { AuditService } from "../services/audit.service.js";

export class AuditController {
  constructor(private readonly audit: AuditService) {}

  list = async (req: Request, res: Response) => {
    const query = req.query as unknown as AuditListQuery;
    await this.audit.record(req, { action: "audit.list", details: { ...query } });
    res.json(await this.audit.list(query));
  };
}
