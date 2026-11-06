import { z } from "zod";

// Simulated orders for the carrier agent, in the shape of a real same-day plan.
export const simulateCarrierSchema = {
  body: z
    .object({
      orders: z
        .array(
          z
            .object({
              orderId: z.string().trim().min(1).max(64),
              warehouseName: z.string().trim().min(1).max(100).nullable(),
              destination: z.string().trim().min(1).max(120),
              region: z.enum(["Midwest", "Northeast", "Southeast", "West"]).nullable(),
            })
            .strict(),
        )
        .min(1)
        .max(25),
    })
    .strict(),
};

export type SimulateCarrierBody = z.infer<typeof simulateCarrierSchema.body>;

// A simulated order email for the email agent.
export const simulateEmailSchema = {
  body: z
    .object({
      from: z.string().trim().min(1).max(200),
      subject: z.string().trim().max(300),
      body: z.string().max(5000),
    })
    .strict(),
};

export type SimulateEmailBody = z.infer<typeof simulateEmailSchema.body>;

const warehouseId = z.string().trim().min(1).max(16);
const cartons = z.number().int().min(0).max(1_000_000);

// Products as the simulation has them, for the allocation agent: cartons available per warehouse and the demand the
// simulation has seen there.
export const simulateRebalanceSchema = {
  body: z
    .object({
      products: z
        .array(
          z
            .object({
              productId: z.string().trim().min(1).max(64),
              stock: z.record(warehouseId, cartons),
              demand: z.record(warehouseId, z.object({ routed: cartons, missed: cartons, sentForOthers: cartons }).strict()),
            })
            .strict(),
        )
        .min(1)
        .max(10),
    })
    .strict(),
};

export type SimulateRebalanceBody = z.infer<typeof simulateRebalanceSchema.body>;
