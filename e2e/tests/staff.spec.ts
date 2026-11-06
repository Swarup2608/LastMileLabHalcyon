import { expect, test } from "@playwright/test";
import { ADMIN_STATE, watchForFailures } from "./helpers";

test.use({ storageState: ADMIN_STATE });

const SCREENS: [path: string, heading: string][] = [
  ["/portal", "Today"],
  ["/portal/orders", "Orders"],
  ["/portal/emails", "Order requests"],
  ["/portal/exceptions", "Exceptions"],
  ["/portal/inventory", "Inventory"],
  ["/portal/carriers", "Carriers"],
  ["/portal/insights", "Insights"],
  ["/portal/team", "Users"],
  ["/portal/clients", "Users"],
];

for (const [path, heading] of SCREENS) {
  test(`${path} opens for an admin`, async ({ page }) => {
    const failures = watchForFailures(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "couldn’t" })).toHaveCount(0);
    failures.expectNone();
  });
}

test("Users lists the clients from the dataset", async ({ page }) => {
  await page.goto("/portal/clients");
  await expect(page.getByRole("row", { name: /^Client 001 C001/ })).toBeVisible();
});
