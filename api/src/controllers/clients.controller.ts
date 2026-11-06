import type { Request, Response } from "express";
import type {
  ClientParams,
  ClientUserParams,
  CreateClientUserBody,
  ListClientsQuery,
  SignupClientBody,
  UpdateClientUserBody,
} from "../schemas/clients.schema.js";
import type { AuditService } from "../services/audit.service.js";
import type { ClientsService } from "../services/clients.service.js";

export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
  ) {}

  list = async (req: Request, res: Response) => {
    const query = req.query as unknown as ListClientsQuery;
    const result = await this.clients.list(query);
    await this.audit.record(req, { action: "client.list", details: { ...query } });
    res.json(result);
  };

  // The contact's starting password is logged only as the contact's email.
  signup = async (req: Request<Record<string, string>, unknown, SignupClientBody>, res: Response) => {
    const { contact, ...company } = req.body;
    const result = await this.clients.signup(req.body);
    await this.audit.record(req, {
      action: "client.signup",
      targetType: "client",
      targetId: result.client.clientId,
      details: { ...company, contactEmail: contact.email, contactUserId: result.user.id },
    });
    res.status(201).json(result);
  };

  get = async (req: Request<ClientParams>, res: Response) => {
    const client = await this.clients.get(req.params.clientId, req.auth!);
    await this.audit.record(req, { action: "client.view", targetType: "client", targetId: req.params.clientId });
    res.json({ client });
  };

  listUsers = async (req: Request<ClientParams>, res: Response) => {
    const users = await this.clients.listUsers(req.params.clientId);
    await this.audit.record(req, { action: "client_user.list", targetType: "client", targetId: req.params.clientId });
    res.json({ users });
  };

  createUser = async (req: Request<ClientParams, unknown, CreateClientUserBody>, res: Response) => {
    const user = await this.clients.createUser(req.params.clientId, req.body);
    await this.audit.record(req, {
      action: "client_user.create",
      targetType: "client_user",
      targetId: user.id,
      details: { clientId: req.params.clientId, email: user.email, name: user.name },
    });
    res.status(201).json({ user });
  };

  // Turning demo off returns the replacement password once.
  setUserDemo = async (req: Request<ClientUserParams, unknown, { isDemo: boolean }>, res: Response) => {
    const result = await this.clients.setUserDemo(req.params.clientId, req.params.userId, req.body.isDemo);
    await this.audit.record(req, {
      action: "client_user.demo",
      targetType: "client_user",
      targetId: req.params.userId,
      details: { clientId: req.params.clientId, isDemo: req.body.isDemo },
    });
    res.json(result);
  };

  // The new password, when an admin resets one, is logged only as passwordReset.
  updateUser = async (req: Request<ClientUserParams, unknown, UpdateClientUserBody>, res: Response) => {
    const { password, ...changes } = req.body;
    const user = await this.clients.updateUser(req.params.clientId, req.params.userId, req.body);
    await this.audit.record(req, {
      action: "client_user.update",
      targetType: "client_user",
      targetId: req.params.userId,
      details: { clientId: req.params.clientId, ...changes, ...(password !== undefined ? { passwordReset: true } : {}) },
    });
    res.json({ user });
  };
}
