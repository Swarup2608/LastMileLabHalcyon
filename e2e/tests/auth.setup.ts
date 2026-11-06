import { randomBytes } from "node:crypto";
import { expect, test as setup } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE, signIn } from "./helpers";

// Signs in once for each role and keeps the cookies. A fresh database has only the admin, so the client login is
// created here, on the company that owns the first product: a new company would have nothing to order.
setup("sign in as admin and as a client", async ({ browser, page }) => {
  await signIn(page, "Halcyon staff", process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await page.context().storageState({ path: ADMIN_STATE });

  const catalogue = await page.request.get("/api/products");
  expect(catalogue.ok()).toBe(true);
  const { products } = (await catalogue.json()) as { products: { clientId: string }[] };
  const clientId = products[0]!.clientId;

  const email = `e2e-client-${Date.now()}@example.com`;
  const password = `e2e-${randomBytes(12).toString("hex")}`;
  const created = await page.request.post(`/api/clients/${clientId}/users`, { data: { email, name: "E2E Client", password } });
  expect(created.ok()).toBe(true);

  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL });
  const clientPage = await context.newPage();
  await signIn(clientPage, "Client", email, password);
  await expect(clientPage.getByRole("heading", { name: "Home" })).toBeVisible();
  await context.storageState({ path: CLIENT_STATE });
  await context.close();
});
