import type { Queryable } from "../db/transaction.js";

export interface ClientRow {
  client_id: string;
  client_name: string | null;
  region: string | null;
  primary_order_channel: string | null;
  account_tier: string | null;
  sla_penalty_clause: string | null;
  annual_revenue_usd: string | null;
  account_status: string | null;
}

export const toClientDto = (row: ClientRow) => ({
  clientId: row.client_id,
  clientName: row.client_name,
  region: row.region,
  primaryOrderChannel: row.primary_order_channel,
  accountTier: row.account_tier,
  slaPenaltyClause: row.sla_penalty_clause === "Y",
  annualRevenueUsd: row.annual_revenue_usd === null ? null : Number(row.annual_revenue_usd),
  accountStatus: row.account_status,
});

export interface ClientFilters {
  q?: string;
  region?: string;
  status?: string;
  limit: number;
  offset: number;
}

const COLUMNS = `client_id, client_name, region, primary_order_channel, account_tier, sla_penalty_clause,
  annual_revenue_usd, account_status`;

// q matches client id or name; region and status are exact matches.
const WHERE = `WHERE ($1::text IS NULL OR lower(client_id) LIKE $1 OR lower(client_name) LIKE $1)
                 AND ($2::text IS NULL OR region = $2)
                 AND ($3::text IS NULL OR account_status = $3)`;

export interface NewClient {
  clientName: string;
  region: string;
  primaryOrderChannel: string;
  accountTier: string;
  slaPenaltyClause: boolean;
  annualRevenueUsd: number | null;
}

// The clients table starts as the supplied dataset; new clients signed up by an admin are added to it.
export class ClientRepository {
  constructor(private readonly db: Queryable) {}

  // Next id in the dataset's C001 style (C281, C282, ...). Two concurrent sign-ups can pick the same id; the
  // primary key rejects the second and the caller retries.
  async nextId() {
    const { rows } = await this.db.query<{ client_id: string }>(`SELECT client_id FROM clients WHERE client_id LIKE 'C%'`);
    const max = rows.reduce((top, { client_id }) => {
      const n = /^C(\d+)$/.exec(client_id)?.[1];
      return n ? Math.max(top, Number(n)) : top;
    }, 0);
    return `C${String(max + 1).padStart(3, "0")}`;
  }

  async insert(clientId: string, input: NewClient) {
    const { rows } = await this.db.query<ClientRow>(
      `INSERT INTO clients (client_id, client_name, region, primary_order_channel, account_tier, sla_penalty_clause,
                            annual_revenue_usd, account_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active') RETURNING ${COLUMNS}`,
      [
        clientId,
        input.clientName,
        input.region,
        input.primaryOrderChannel,
        input.accountTier,
        input.slaPenaltyClause ? "Y" : "N",
        input.annualRevenueUsd,
      ],
    );
    return rows[0];
  }

  async list({ q, region, status, limit, offset }: ClientFilters) {
    const params = [q ? `%${q.toLowerCase()}%` : null, region ?? null, status ?? null];
    const [page, count] = await Promise.all([
      this.db.query<ClientRow>(`SELECT ${COLUMNS} FROM clients ${WHERE} ORDER BY client_id LIMIT $4 OFFSET $5`, [
        ...params,
        limit,
        offset,
      ]),
      this.db.query<{ total: string }>(`SELECT count(*) AS total FROM clients ${WHERE}`, params),
    ]);
    return { rows: page.rows, total: Number(count.rows[0].total) };
  }

  async findById(clientId: string) {
    const { rows } = await this.db.query<ClientRow>(`SELECT ${COLUMNS} FROM clients WHERE client_id = $1`, [clientId]);
    return rows[0] ?? null;
  }

  async exists(clientId: string) {
    const { rowCount } = await this.db.query(`SELECT 1 FROM clients WHERE client_id = $1`, [clientId]);
    return Boolean(rowCount);
  }
}
