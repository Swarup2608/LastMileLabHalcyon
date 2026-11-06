import type { Request, Response } from "express";
import type { ProductsService } from "../services/products.service.js";

export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  list = async (req: Request, res: Response) => {
    res.json({ products: await this.products.list(req.auth!) });
  };
}
