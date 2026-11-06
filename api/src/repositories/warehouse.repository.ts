import type { Pool } from "pg";

export interface WarehouseRow {
  warehouse_id: string;
  warehouse_name: string | null;
  region: string | null;
  pick_list_cutoff: string | null;
  carrier_collection_window: string | null;
  midwest: number | null;
  southeast: number | null;
  northeast: number | null;
  west: number | null;
}

export const toWarehouseDto = (row: WarehouseRow) => ({
  warehouseId: row.warehouse_id,
  warehouseName: row.warehouse_name,
  region: row.region,
  pickListCutoff: row.pick_list_cutoff,
  carrierCollectionWindow: row.carrier_collection_window,
  // Miles from this warehouse to each destination region, when the dataset has them.
  milesToRegion: {
    Midwest: row.midwest,
    Southeast: row.southeast,
    Northeast: row.northeast,
    West: row.west,
  },
});

// Read-only: warehouses and their region distances are the supplied dataset.
export class WarehouseRepository {
  constructor(private readonly db: Pool) {}

  async list() {
    const { rows } = await this.db.query<WarehouseRow>(
      `SELECT w.warehouse_id, w.warehouse_name, w.region, w.pick_list_cutoff, w.carrier_collection_window,
              d.midwest, d.southeast, d.northeast, d.west
       FROM warehouses w LEFT JOIN warehouse_region_distance d ON d.warehouse_id = w.warehouse_id
       ORDER BY w.warehouse_id`,
    );
    return rows;
  }
}
