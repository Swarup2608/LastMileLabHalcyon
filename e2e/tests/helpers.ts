import { expect, type Page } from "@playwright/test";

export const ADMIN_STATE = ".auth/admin.json";
export const CLIENT_STATE = ".auth/client.json";

// The form starts on Client, so staff pick their toggle first.
export async function signIn(page: Page, realm: "Client" | "Halcyon staff", email: string, password: string) {
  await page.goto("/signin");
  await page.getByRole("group", { name: "Account type" }).getByRole("button", { name: realm }).click();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

// Fails a test if the page throws or the API answers 5xx, even when the screen still shows its heading.
export function watchForFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (err) => failures.push(`page error: ${err.message}`));
  page.on("response", (res) => {
    if (res.status() >= 500) failures.push(`${res.status()} from ${res.url()}`);
  });
  return { expectNone: () => expect(failures).toEqual([]) };
}
