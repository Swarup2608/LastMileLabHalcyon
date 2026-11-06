import { expect, test } from "@playwright/test";
import { CLIENT_STATE, watchForFailures } from "./helpers";

test.use({ storageState: CLIENT_STATE });

const SCREENS: [path: string, heading: string][] = [
  ["/portal", "Home"],
  ["/portal/products", "Products"],
  ["/portal/orders", "Orders"],
  ["/portal/messages", "Messages"],
];

for (const [path, heading] of SCREENS) {
  test(`${path} opens for a client`, async ({ page }) => {
    const failures = watchForFailures(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "couldn’t" })).toHaveCount(0);
    failures.expectNone();
  });
}

test("Products shows the client's own catalogue", async ({ page }) => {
  await page.goto("/portal/products");
  await expect(page.getByText(/^[1-9]\d* products$/)).toBeVisible();
});

for (const path of ["/portal/team", "/portal/inventory", "/portal/emails", "/portal/rules"]) {
  test(`a client opening ${path} is sent back to Home`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  });
}
