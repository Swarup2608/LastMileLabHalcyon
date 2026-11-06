import type { Pool, PoolClient } from "pg";

// What repositories run queries on: the pool, or one checked-out client inside a transaction.
export type Queryable = Pool | PoolClient;

// Runs fn inside BEGIN/COMMIT on a single connection; any throw rolls everything back.
export async function withTransaction<T>(db: Pool, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query("BEGIN");
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (err) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    tx.release();
  }
}
