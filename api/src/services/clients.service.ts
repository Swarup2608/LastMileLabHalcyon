import type { Pool } from "pg";
import { withTransaction, type Queryable } from "../db/transaction.js";
import { ClientUserRepository, toClientUserDto } from "../repositories/client-user.repository.js";
import { ClientRepository, toClientDto } from "../repositories/client.repository.js";
import { ProductRepository } from "../repositories/product.repository.js";
import type { SessionRepository } from "../repositories/session.repository.js";
import type {
  CreateClientUserBody,
  ListClientsQuery,
  SignupClientBody,
  UpdateClientUserBody,
} from "../schemas/clients.schema.js";
import type { AccessClaims } from "../types/auth.js";
import { badRequest, conflict, isUniqueViolation, notFound } from "../utils/http-error.js";
import { DEMO_MODE_OFF } from "./staff.service.js";
import { generatePassword, hashPassword } from "../utils/password.js";

const EMAIL_TAKEN = "A client user with this email already exists";
// Attempts at picking a free client id when concurrent sign-ups collide on the same one.
const SIGNUP_ATTEMPTS = 3;

export class ClientsService {
  constructor(
    private readonly db: Pool,
    private readonly clients: ClientRepository,
    private readonly clientUsers: ClientUserRepository,
    private readonly sessions: SessionRepository,
    private readonly demoMode = true,
  ) {}

  // Creates the client company, its first login and a full catalogue in one transaction, so no client ever exists
  // without a login or with nothing to order. `alongside` adds to the same transaction: the marketplace places the
  // client's first order there.
  async signup({ contact, ...company }: SignupClientBody, alongside?: (tx: Queryable, clientId: string, userId: string) => Promise<void>) {
    if (await this.clientUsers.findByEmail(contact.email)) throw conflict(EMAIL_TAKEN);
    const passwordHash = await hashPassword(contact.password);

    for (let attempt = 1; ; attempt++) {
      try {
        return await withTransaction(this.db, async (tx) => {
          const clients = new ClientRepository(tx);
          const client = await clients.insert(await clients.nextId(), company);
          const user = await new ClientUserRepository(tx).insert({
            clientId: client.client_id,
            email: contact.email,
            name: contact.name,
            passwordHash,
          });
          await new ProductRepository(tx).fillCatalogue(client.client_id);
          await alongside?.(tx, client.client_id, user.client_user_id);
          return { client: toClientDto(client), user: toClientUserDto(user) };
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Either the email was taken in the meantime, or another sign-up got this client id first.
        if (await this.clientUsers.findByEmail(contact.email)) throw conflict(EMAIL_TAKEN);
        if (attempt >= SIGNUP_ATTEMPTS) throw err;
      }
    }
  }

  async list(query: ListClientsQuery) {
    const { rows, total } = await this.clients.list(query);
    return { clients: rows.map(toClientDto), total, limit: query.limit, offset: query.offset };
  }

  // Staff can read any client; a client user only their own company (anything else looks like it doesn't exist).
  async get(clientId: string, viewer: AccessClaims) {
    if (viewer.typ === "client" && viewer.clientId !== clientId) throw notFound();
    const row = await this.clients.findById(clientId);
    if (!row) throw notFound();
    return toClientDto(row);
  }

  async listUsers(clientId: string) {
    if (!(await this.clients.exists(clientId))) throw notFound();
    return (await this.clientUsers.listByClient(clientId)).map(toClientUserDto);
  }

  async createUser(clientId: string, { email, name, password }: CreateClientUserBody) {
    if (!(await this.clients.exists(clientId))) throw notFound();
    try {
      const row = await this.clientUsers.insert({ clientId, email, name, passwordHash: await hashPassword(password) });
      return toClientUserDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(EMAIL_TAKEN);
      throw err;
    }
  }

  // Deactivating or resetting the password ends the user's sessions.
  async updateUser(clientId: string, userId: string, { name, isActive, password }: UpdateClientUserBody) {
    if (password !== undefined && (await this.clientUsers.findActiveById(userId))?.is_demo) {
      throw badRequest("turn off demo for this login before setting its password");
    }
    const row = await this.clientUsers.update(clientId, userId, {
      name,
      isActive,
      passwordHash: password ? await hashPassword(password) : undefined,
    });
    if (!row) throw notFound();
    if (isActive === false || password !== undefined) await this.sessions.revokeAllFor("client", userId);
    return toClientUserDto(row);
  }

  // Same as staff demo accounts: a fresh password either way; turning demo off returns it once for the admin.
  async setUserDemo(clientId: string, userId: string, isDemo: boolean) {
    if (isDemo && !this.demoMode) throw conflict(DEMO_MODE_OFF);
    const password = generatePassword();
    const row = await this.clientUsers.setDemo(clientId, userId, {
      isDemo,
      demoPassword: isDemo ? password : null,
      passwordHash: await hashPassword(password),
    });
    if (!row) throw notFound();
    await this.sessions.revokeAllFor("client", userId);
    return { user: toClientUserDto(row), ...(isDemo ? {} : { temporaryPassword: password }) };
  }
}
