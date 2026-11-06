// Read-only database helpers for the db:tables script. Every function takes the pool it runs on, so the caller owns
// connecting and closing.
import type { Pool } from "pg";

const MASKED = /password|hash/i;

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

export async function tableNames(db: Pool) {
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
}

async function rowCount(db: Pool, table: string) {
  const { rows } = await db.query<{ count: string }>(`SELECT count(*) AS count FROM ${quoteIdent(table)}`);
  return Number(rows[0].count);
}

// Every table in the public schema, with its row count.
export async function listTables(db: Pool) {
  const names = await tableNames(db);
  const counts = await Promise.all(names.map((name) => rowCount(db, name)));
  return names.map((table, i) => ({ table, rows: counts[i] }));
}

// The first `limit` rows of a table (null for every row), with password hashes masked. Returns null when there is no
// such table; only names that really exist reach the SQL, so the argument can't inject anything.
export async function readTable(db: Pool, table: string, limit: number | null) {
  if (!(await tableNames(db)).includes(table)) return null;

  const [total, result] = await Promise.all([
    rowCount(db, table),
    db.query(`SELECT * FROM ${quoteIdent(table)}${limit === null ? "" : " LIMIT $1"}`, limit === null ? [] : [limit]),
  ]);
  // Some drivers (pg-mem) leave fields empty; the first row's keys are the same columns.
  const columns = result.fields?.length ? result.fields.map((f) => f.name) : Object.keys(result.rows[0] ?? {});
  const masked = columns.filter((name) => MASKED.test(name));
  const rows = result.rows.map((row) => {
    for (const name of masked) if (row[name] !== null) row[name] = "••••••";
    return row;
  });
  return { table, total, columns, masked, rows };
}
