import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config/env.js";

const required = { DATABASE_URL: "postgres://x", JWT_SECRET: "x".repeat(32) };

describe("demo settings", () => {
  it("defaults to demo on", () => assert.equal(loadConfig(required).demoMode, true));

  it("DEMO_MODE=false turns it off", () => assert.equal(loadConfig({ ...required, DEMO_MODE: "false" }).demoMode, false));
});
