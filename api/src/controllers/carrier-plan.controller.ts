import type { Request, Response } from "express";
import type { CarrierPlanRepository, CarrierPlanRow } from "../repositories/carrier-plan.repository.js";
import type { CarrierAssignBody, CarrierChoiceBody } from "../schemas/carrier-plan.schema.js";
import type { AuditService } from "../services/audit.service.js";
import { checkOf, type CarrierPlanService, type PlanInput } from "../services/carrier-plan.service.js";
import { HttpError } from "../utils/http-error.js";

const toPlanDto = (row: CarrierPlanRow, assignments: Awaited<ReturnType<CarrierPlanService["assignments"]>>) => ({
  date: row.plan_date,
  report: row.report,
  // The validator's errors and the orders cleared for dispatch; null when the agent wasn't asked.
  check: row.report ? checkOf(row.input as PlanInput, row.report) : null,
  input: row.input,
  // By order id: the orders on the plan already assigned to a carrier.
  assignments,
  agent: row.agent,
  // null: made by the API at the cutoff.
  runBy: row.run_by,
  createdAt: row.created_at,
});

export class CarrierPlanController {
  constructor(
    private readonly service: CarrierPlanService,
    private readonly plans: CarrierPlanRepository,
    private readonly audit: AuditService,
  ) {}

  private dto = async (row: CarrierPlanRow) => toPlanDto(row, await this.service.assignments(row.input as PlanInput));

  // Today's plan, or null before the cutoff / before it has run, with the cutoff it waits for.
  get = async (_req: Request, res: Response) => {
    const { rule, today, passed } = await this.service.status();
    const plan = await this.plans.get(today);
    res.json({
      enabled: this.service.enabled,
      today,
      cutoff: rule.sameDayCutoff,
      timeZone: rule.timeZone,
      cutoffPassed: passed,
      waiting: await this.service.waiting((plan?.input as PlanInput | undefined)?.orders),
      plan: plan ? await this.dto(plan) : null,
    });
  };

  // Makes today's plan now, at any time of day, e.g. after staff routed a late order.
  run = async (req: Request, res: Response) => {
    if (!this.service.enabled) throw new HttpError(503, "Carrier agent is not configured");
    const { today } = await this.service.status();
    const { orders } = await this.service.run(req.auth!.sub);
    await this.audit.record(req, { action: "carrier_plan.run", targetType: "carrier_plan", targetId: today, details: { orders } });
    res.json({ plan: await this.dto((await this.plans.get(today))!) });
  };

  // Assigns the plan's orders to their carriers: staff's pick, else the agent's.
  assign = async (req: Request<Record<string, string>, unknown, CarrierAssignBody>, res: Response) => {
    const override = req.body.override ?? false;
    const { date, assigned, skipped } = await this.service.assign(req.auth!.sub, override);
    await this.audit.record(req, { action: "carrier_plan.assign", targetType: "carrier_plan", targetId: date, details: { assigned, skipped, override } });
    res.json({ plan: await this.dto((await this.plans.get(date))!), assigned: assigned.length, skipped });
  };

  // Staff pick an order's carrier, or go back to the agent's, until it's assigned: a cleared order can still change.
  choose = async (req: Request<Record<string, string>, unknown, CarrierChoiceBody>, res: Response) => {
    const { orderId, carrier } = req.body;
    const today = await this.service.choose(orderId, carrier, req.auth!.sub);
    await this.audit.record(req, { action: "carrier_plan.choose", targetType: "carrier_plan", targetId: today, details: { orderId, carrier } });
    res.json({ plan: await this.dto((await this.plans.get(today))!) });
  };
}
