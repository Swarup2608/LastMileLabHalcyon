import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("the landing page links to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Stop late deliveries");
  await page.getByRole("link", { name: /sign in/i }).first().click();
  await expect(page).toHaveURL(/\/signin/);
});

test("a visitor who isn't signed in is sent to sign-in and remembers the page", async ({ page }) => {
  await page.goto("/portal/orders");
  await expect(page).toHaveURL(/\/signin\?next=%2Fportal%2Forders$/);
  await expect(page.getByRole("heading", { name: "Sign in to Halcyon" })).toBeVisible();
});

test("a wrong password shows an error and stays on sign-in", async ({ page }) => {
  await signIn(page, "Halcyon staff", process.env.E2E_ADMIN_EMAIL!, "not-the-password");
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await expect(page).toHaveURL(/\/signin/);
});
