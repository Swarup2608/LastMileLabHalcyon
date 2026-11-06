import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { badRequest } from "../utils/http-error.js";

export interface RequestSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

// Parses each part of the request with its zod schema and replaces it with the parsed (trimmed, coerced,
// defaulted) value, so controllers only ever see valid input. Any failure is a 400 listing every issue.
export const validate =
  (schemas: RequestSchemas): RequestHandler =>
  (req, _res, next) => {
    const issues: { location: string; path: string; message: string }[] = [];

    for (const location of ["params", "query", "body"] as const) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(req[location] ?? {});
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({ location, path: issue.path.join("."), message: issue.message });
        }
        continue;
      }
      // req.query is a getter in Express 5, so it is redefined on the request rather than assigned.
      if (location === "query") Object.defineProperty(req, "query", { value: result.data, writable: true });
      else req[location] = result.data as never;
    }

    if (issues.length) throw badRequest("Validation failed", issues);
    next();
  };
