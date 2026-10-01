// The Layer 1 admin flows against the real api (roadmap M1.11): accept the
// invitation, enroll an authenticator, sign in with it, invite a colleague
// with a role, see it in the audit log, sign out and back in, and confirm the
// refresh cookie restores the session while the access token never persists.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { Authenticator } from "../../../services/api/scripts/totp.ts";
import { STACK_FILE } from "./stack.ts";

const stack = JSON.parse(readFileSync(STACK_FILE, "utf8")) as { invitationToken: string; email: string };
const PASSWORD = "violet harbour lantern 42";
let authenticator: Authenticator;

// Each sign-in needs a TOTP step not used before (replays are refused), so a
// test may wait up to one 30-second step for the clock.
test.describe.configure({ mode: "serial", timeout: 90_000 });

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(stack.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await page.getByLabel("Code", { exact: true }).fill(await authenticator.next());
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

test("accepts the invitation and sets up the authenticator", async ({ page }) => {
  await page.goto(`/accept-invitation#token=${stack.invitationToken}`);
  // The token leaves the address bar at once.
  await expect(page).toHaveURL(/\/accept-invitation$/);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("heading", { name: "You are all set" })).toBeVisible();

  await page.getByRole("link", { name: "Sign in" }).click();
  await page.getByLabel("Email", { exact: true }).fill(stack.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // An administrator must have a second factor: enrollment comes first.
  await expect(page.getByRole("heading", { name: "Set up your authenticator" })).toBeVisible();
  await page.getByRole("button", { name: "Show my setup key" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  authenticator = new Authenticator(secret);
  await page.getByLabel("Code from the app").fill(await authenticator.next());
  await page.getByRole("button", { name: "Confirm authenticator" }).click();

  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await page.getByLabel("Code", { exact: true }).fill(await authenticator.next());
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByText("Synthetic Demo Organization")).toBeVisible();
});

test("refuses a wrong password with the server's message", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(stack.email);
  await page.getByLabel("Password", { exact: true }).fill("not the password at all");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText(/incorrect/i);
});

test("invites a user with a role and records it in the audit log", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await page.getByRole("button", { name: "Invite user" }).click();
  await page.getByLabel("Email", { exact: true }).fill("frontdesk@synthetic-demo.test");
  await page.getByLabel("Name", { exact: true }).fill("Jordan Desk");
  await page.getByLabel("Role (organization-wide)").selectOption({ label: "Front desk" });
  await page.getByRole("button", { name: "Send invitation" }).click();

  const row = page.getByRole("row", { name: /Jordan Desk/ });
  await expect(row).toContainText("Invited");
  await expect(row).toContainText("Front desk");

  await row.getByRole("button", { name: "Jordan Desk" }).click();
  await expect(page.getByRole("heading", { name: "Jordan Desk" })).toBeVisible();

  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /User created/i }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /Role assigned/i }).first()).toBeVisible();
});

test("restores the session from the cookie, keeps no token in storage, and signs out", async ({ page }) => {
  await signIn(page);
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

  const stored = await page.evaluate(
    () => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
  );
  expect(stored).toBe("{}{}");
  const cookies = await page.context().cookies();
  const refresh = cookies.find((c) => c.name === "aestara_rt");
  expect(refresh?.httpOnly).toBe(true);
  expect(refresh?.path).toBe("/api/v1/auth/token/refresh");
  expect(refresh?.sameSite).toBe("Strict");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("lists this browser among the account's devices", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: /Demo Admin|admin@synthetic-demo.test/ }).click();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  await expect(page.getByText("This browser")).toBeVisible();
});
