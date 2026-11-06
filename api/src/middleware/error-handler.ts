import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError, notFound } from "../utils/http-error.js";

export const notFoundHandler: RequestHandler = () => {
  throw notFound();
};

// Last middleware: every error is logged to the console. Known errors become { error, details? }; anything else is
// hidden behind a 500.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    console.log(`${req.method} ${req.originalUrl} -> ${err.status} ${err.message}`, err.details === undefined ? "" : JSON.stringify(err.details));
    res.status(err.status).json(err.details === undefined ? { error: err.message } : { error: err.message, details: err.details });
    return;
  }
  // Malformed or oversized JSON bodies from express.json().
  if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
    console.log(`${req.method} ${req.originalUrl} -> ${err.status ?? 400} invalid request body (${err.type})`);
    res.status(err.status ?? 400).json({ error: "Invalid request body" });
    return;
  }
  console.error(`${req.method} ${req.originalUrl} failed`, err);
  res.status(500).json({ error: "Internal Server Error" });
};
