import { Router } from "express";
import type { EmailsController } from "../controllers/emails.controller.js";
import { requireRole } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import {
  answerRequestSchema,
  createOrderSchema,
  getEmailSchema,
  ignoreSchema,
  listEmailsSchema,
  saveRequestSchema,
  stockDraftSchema,
  stockResponseSchema,
} from "../schemas/emails.schema.js";

// Mounted at /api/emails. Staff only: mail received by the polled Gmail inbox, newest first, and their work on the
// order request behind each.
export function emailsRoutes(controller: EmailsController) {
  const router = Router();
  router.use(requireRole("admin", "contributor"));
  router.get("/", validate(listEmailsSchema), controller.list);
  router.post("/analyze", controller.analyze);
  router.get("/:messageId", validate(getEmailSchema), controller.get);
  router.put("/:messageId/request", validate(saveRequestSchema), controller.saveRequest);
  router.put("/:messageId/ignored", validate(ignoreSchema), controller.setIgnored);
  router.post("/:messageId/stock-flag/draft", validate(stockDraftSchema), controller.stockDraft);
  return router;
}

// Mounted at /api/order-requests. Client users only: the order requests linked to their client (emailed or placed
// through the API), placing a new one or emailing it to the order inbox, and their answers to what staff asked.
export function orderRequestsRoutes(controller: EmailsController) {
  const router = Router();
  router.use(requireRole("client"));
  router.get("/", controller.mine);
  router.post("/", validate(createOrderSchema), controller.create);
  router.get("/email", controller.emailInfo);
  router.post("/email", validate(createOrderSchema), controller.sendEmail);
  router.post("/:messageId/answers", validate(answerRequestSchema), controller.answer);
  router.post("/:messageId/stock-flag", validate(stockResponseSchema), controller.stockResponse);
  return router;
}
