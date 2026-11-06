import type { Pool } from "pg";
import { DEFAULT_DELIVERY_RULE, type DeliveryRule } from "../utils/delivery.js";

// app_settings (db/init/08_settings.sql): one JSON value per key, changed by admins.
export class SettingsRepository {
  constructor(private readonly db: Pool) {}

  // The same-day cutoff; the defaults when no admin has set one.
  async deliveryRule(): Promise<DeliveryRule> {
    const { rows } = await this.db.query<{ value: Partial<DeliveryRule> }>(`SELECT value FROM app_settings WHERE key = 'delivery'`);
    return { ...DEFAULT_DELIVERY_RULE, ...rows[0]?.value };
  }

  async setDeliveryRule(rule: DeliveryRule, by: string) {
    await this.db.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('delivery', $1::jsonb, $2::uuid, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(rule), by],
    );
  }
}
