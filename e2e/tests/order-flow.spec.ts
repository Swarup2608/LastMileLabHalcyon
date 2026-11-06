import { expect, test } from "@playwright/test";
import { ADMIN_STATE, CLIENT_STATE } from "./helpers";

// The main path through the app, across both portals: New order, My orders, then Resolve.
test.describe.configure({ mode: "serial" });

// A new PO each run, so a retry isn't refused as the same order placed twice.
const po = `E2E-${Date.now()}`;
let ref: string;

test.describe("as the client", () => {
  test.use({ storageState: CLIENT_STATE });

  test("New order refuses an incomplete address", async ({ page }) => {
    await page.goto("/portal/orders/new");
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByText("Enter the street.")).toBeVisible();
    await expect(page.getByText("Enter the postal code.")).toBeVisible();
    await expect(page).toHaveURL(/\/portal\/orders\/new$/);
  });

  test("New order places an order and opens it", async ({ page }) => {
    await page.goto("/portal/orders/new");
    await page.getByLabel(/^Cartons of /).fill("2");
    await page.getByLabel("Your PO number").fill(po);
    await page.getByLabel("Street").fill("200 W Madison St");
    await page.getByLabel("City").fill("Chicago");
    await page.getByLabel("State").fill("IL");
    await page.getByLabel("Postal code").fill("60606");
    await page.getByRole("button", { name: "Place order" }).click();

    await expect(page).toHaveURL(/\/portal\/orders\/(?!new$)[^/]+$/);
    ref = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("200 W Madison St").first()).toBeVisible();
  });

  test("My orders lists the new order and opens it", async ({ page }) => {
    await page.goto("/portal/orders");
    await page.getByPlaceholder("Order, product or address").fill(ref);
    await page.getByText(ref, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/portal/orders/${ref}$`));
  });
});

test.describe("as staff", () => {
  test.use({ storageState: ADMIN_STATE });

  test("Resolve shows the order complete and staff can re-route it", async ({ page }) => {
    await page.goto("/portal/orders");
    await page.getByPlaceholder("Order, client, product or address").fill(ref);
    await page.getByText(ref, { exact: true }).click();

    await expect(page).toHaveURL(/\/portal\/emails\//);
    await expect(page.getByRole("heading", { name: "Everything’s in place" })).toBeVisible();

    // A complete order routes itself; staff can undo that and route it by hand.
    await page.getByRole("button", { name: "Change warehouse" }).click();
    const route = page.getByRole("button", { name: "Route order" });
    await expect(route).toBeEnabled();
    // Resolve saves a moment after each change, so wait for the API to have it before leaving the page.
    const saved = page.waitForResponse((res) => res.request().method() === "PUT" && res.url().endsWith("/request") && res.ok());
    await route.click();
    await expect(page.getByRole("button", { name: "Change warehouse" })).toBeVisible();
    await saved;
  });
});

test.describe("back as the client", () => {
  test.use({ storageState: CLIENT_STATE });

  test("the order page shows the warehouse it ships from", async ({ page }) => {
    await page.goto(`/portal/orders/${ref}`);
    await expect(page.getByText(/^Shipping from /).first()).toBeVisible();
    await expect(page.getByText("Chosen once everything’s in")).toHaveCount(0);
  });
});
