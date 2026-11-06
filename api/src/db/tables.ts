// Read-only look at the database in DATABASE_URL.
//   npm run db:tables                 every table in the public schema, with its row count
//   npm run db:tables <table>         the first 50 rows of that table
//   npm run db:tables <table> <n>     the first n rows (n = all for every row)
// Password hashes are masked; nothing is ever written.
import "dotenv/config";
import { Pool } from "pg";
import { listTables, readTable, tableNames } from "./maintenance.js";

const DEFAULT_LIMIT = 50;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const [tableArg, limitArg] = process.argv.slice(2);

const db = new Pool({ connectionString: url });

async function printTables() {
  const tables = await listTables(db);
  if (!tables.length) console.log("No tables in the public schema.");
  else console.table(tables);
}

async function printTable(table: string, limit: number | null) {
  const result = await readTable(db, table, limit);
  if (!result) {
    console.error(`No table named "${table}". Tables: ${(await tableNames(db)).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const { total, columns, masked, rows } = result;
  console.log(`${table}: showing ${rows.length} of ${total} row${total === 1 ? "" : "s"}${masked.length ? ` (masked: ${masked.join(", ")})` : ""}`);
  if (rows.length) console.table(rows);
  else console.log(`Columns: ${columns.join(", ")}`);
}

function parseLimit(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_LIMIT;
  if (value === "all") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Row limit must be a positive number or "all", got "${value}"`);
  return n;
}

try {
  if (tableArg) await printTable(tableArg, parseLimit(limitArg));
  else await printTables();
} finally {
  await db.end();
}
