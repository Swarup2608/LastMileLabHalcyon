import { expect, test } from "@playwright/test";
import { ADMIN_STATE } from "./helpers";

// The public shop end to end: no sign-in, a cart, Create client, and the order in both portals.
test.describe.configure({ mode: "serial" });

let ref: string;

test("a visitor orders from the marketplace and creates their client", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Open the marketplace" }).first().click();
  await expect(page).toHaveURL(/\/marketplace$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Halcyon’s catalogue".replace("’", "'"));

  const place = page.getByRole("button", { name: "Place order" });
  await expect(place).toBeDisabled();
  await page.getByRole("button", { name: /^Add .* to cart$/ }).first().click();
  await expect(place).toBeEnabled();
  await page.screenshot({ path: "test-results/marketplace.png", fullPage: false });
  await place.click();
  await expect(page).toHaveURL(/\/marketplace\/create-client$/);

  await page.getByRole("button", { name: "Create client and place order" }).click();
  await expect(page.getByText("Enter the company name.")).toBeVisible();

  await page.getByLabel("Company name").fill("Open Door Supply");
  await page.getByLabel("Your name").fill("Ria Sen");
  await page.getByLabel("Work email").fill(`ria-${Date.now()}@opendoor.example`);
  await page.getByLabel("Choose a password").fill("open-door-2026");
  await page.getByLabel("Street").fill("200 W Madison St");
  await page.getByLabel("City").fill("Chicago");
  await page.getByLabel("State").fill("IL");
  await page.getByLabel("Postal code").fill("60606");
  await page.screenshot({ path: "test-results/create-client.png", fullPage: false });
  await page.getByRole("button", { name: "Create client and place order" }).click();

  await expect(page).toHaveURL(/\/portal\/orders\/REQ-/);
  ref = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
  await expect(page.getByText("200 W Madison St").first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/buyer-order.png", fullPage: false });

  // Never an empty catalogue: the new client can order again straight away.
  await page.goto("/portal/orders/new");
  await expect(page.getByRole("heading", { name: "New order" })).toBeVisible();
  await expect(page.getByText("6 products")).toBeVisible();
  await expect(page.getByText("nothing to order")).toHaveCount(0);
});

test.describe("as staff", () => {
  test.use({ storageState: ADMIN_STATE });

  test("the marketplace order reaches staff with its product matched", async ({ page }) => {
    await page.goto("/portal/orders");
    await page.getByPlaceholder("Order, client, product or address").fill(ref);
    await page.getByText(ref, { exact: true }).click();
    await expect(page).toHaveURL(/\/portal\/emails\//);
    await page.waitForTimeout(800);
    await page.screenshot({ path: "test-results/staff-order.png", fullPage: false });
    await expect(page.getByText("Open Door Supply").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Everything’s in place" })).toBeVisible();
  });
});

test("the public catalogue never names the client or warehouse", async ({ request }) => {
  const res = await request.get("/api/marketplace/products");
  expect(res.ok()).toBe(true);
  const text = await res.text();
  expect(text).not.toMatch(/clientId|clientName|warehouseId|binLocation|onHand/);
});
