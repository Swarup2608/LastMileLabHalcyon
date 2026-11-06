import type { Request, Response } from "express";
import type { SimulateCarrierBody, SimulateEmailBody, SimulateRebalanceBody } from "../schemas/simulation.schema.js";
import type { CarrierPlanService } from "../services/carrier-plan.service.js";
import type { RebalanceService } from "../services/rebalance.service.js";
import type { EmailAgentService } from "../services/email-agent.service.js";
import { HttpError } from "../utils/http-error.js";

// The web Simulation's live agents: the real carrier, email and allocation agents asked about the simulation's orders
// and stock. Nothing is read from or saved to the real orders, plans or stock; only the catalogue, warehouses and
// carrier figures are the real ones.
export class SimulationController {
  constructor(
    private readonly carrierPlan: CarrierPlanService,
    private readonly rebalance: RebalanceService,
    private readonly emailAgent?: EmailAgentService,
  ) {}

  // Which agents the API has, so the page can say what's live.
  status = (_req: Request, res: Response) => {
    res.json({ carrier: this.carrierPlan.enabled, email: !!this.emailAgent, allocation: this.rebalance.enabled });
  };

  carrier = async (req: Request, res: Response) => {
    if (!this.carrierPlan.enabled) throw new HttpError(503, "Carrier agent is not configured");
    const { orders } = req.body as SimulateCarrierBody;
    const { report, check, agent } = await this.carrierPlan.preview(orders.map((o) => ({ ...o, shippingPriority: "Same-day" as const })));
    res.json({ report, check, agent });
  };

  // The allocation agent on the simulation's own stock and demand; the catalogue and warehouses are the real ones.
  rebalanceProducts = async (req: Request, res: Response) => {
    if (!this.rebalance.enabled) throw new HttpError(503, "Allocation agent is not configured");
    const { products } = req.body as SimulateRebalanceBody;
    const input = await this.rebalance.simulatedInput(products);
    if (!input.products.length) throw new HttpError(404, "None of those products is in the catalogue");
    res.json(await this.rebalance.suggestFor(input));
  };

  email = async (req: Request, res: Response) => {
    if (!this.emailAgent) throw new HttpError(503, "Email agent is not configured");
    const { from, subject, body } = req.body as SimulateEmailBody;
    const reply = await this.emailAgent.preview({
      mailbox: "simulation",
      messageId: `sim-${Date.now().toString(36)}`,
      from,
      subject,
      date: new Date().toISOString(),
      body,
    });
    res.json({ agent: reply.agent, output: reply.output });
  };
}
