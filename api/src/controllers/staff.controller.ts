import type { Request, Response } from "express";
import type { CreateStaffBody, StaffParams, UpdateStaffBody } from "../schemas/staff.schema.js";
import type { AuditService } from "../services/audit.service.js";
import type { StaffService } from "../services/staff.service.js";

export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly audit: AuditService,
  ) {}

  list = async (req: Request, res: Response) => {
    const staff = await this.staff.list();
    await this.audit.record(req, { action: "staff.list" });
    res.json({ staff });
  };

  get = async (req: Request<StaffParams>, res: Response) => {
    const staff = await this.staff.get(req.params.id);
    await this.audit.record(req, { action: "staff.view", targetType: "staff", targetId: req.params.id });
    res.json({ staff });
  };

  create = async (req: Request<Record<string, string>, unknown, CreateStaffBody>, res: Response) => {
    const result = await this.staff.create(req.body, req.auth!.isDemo === true);
    await this.audit.record(req, { action: "staff.create", targetType: "staff", targetId: result.staff.id, details: { ...req.body } });
    res.status(201).json(result);
  };

  // Turning demo off returns the replacement password once.
  setDemo = async (req: Request<StaffParams, unknown, { isDemo: boolean }>, res: Response) => {
    const result = await this.staff.setDemo(req.params.id, req.body.isDemo, req.auth!.sub);
    await this.audit.record(req, { action: "staff.demo", targetType: "staff", targetId: req.params.id, details: { isDemo: req.body.isDemo } });
    res.json(result);
  };

  // The new password, when an admin resets one, is logged only as passwordReset.
  update = async (req: Request<StaffParams, unknown, UpdateStaffBody>, res: Response) => {
    const { password, ...changes } = req.body;
    const staff = await this.staff.update(req.params.id, req.body, req.auth!.sub, req.auth!.isDemo === true);
    await this.audit.record(req, {
      action: "staff.update",
      targetType: "staff",
      targetId: req.params.id,
      details: { ...changes, ...(password !== undefined ? { passwordReset: true } : {}) },
    });
    res.json({ staff });
  };
}
