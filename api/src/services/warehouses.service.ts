import { toWarehouseDto, type WarehouseRepository } from "../repositories/warehouse.repository.js";

export class WarehousesService {
  constructor(private readonly warehouses: WarehouseRepository) {}

  async list() {
    return (await this.warehouses.list()).map(toWarehouseDto);
  }
}
