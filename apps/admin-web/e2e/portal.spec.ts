// The admin flows against the real api (roadmap M1.11, M2.3, M2.10): accept the
// invitation, enroll an authenticator, sign in with it, invite a colleague
// with a role, see it in the audit log, sign out and back in, and confirm the
// refresh cookie restores the session while the access token never persists;
// then author a photo protocol, change the Layer 2 configuration and build the
// treatment catalog (M4.1).
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

// The Content Security Policy must never block the portal itself.
let violations: string[] = [];
test.beforeEach(({ page }) => {
  violations = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text()))
      violations.push(message.text());
  });
});
test.afterEach(() => expect(violations).toEqual([]));

test("serves the portal with its security headers", async ({ request }) => {
  const response = await request.get("/");
  const csp = response.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(await response.text()).toContain('http-equiv="Content-Security-Policy"');
});

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

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
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

// Layer 2 (M2.3, ADR-0023 K2-10, K2-11): the standard protocols are there; a
// custom draft is edited, activated, then replaced by a new version.
test("authors, activates and replaces a photo protocol", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Photo protocols" }).click();
  await expect(page.getByRole("heading", { name: "Photo protocols" })).toBeVisible();
  for (const name of ["Face", "Breast", "Abdomen/body contour"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New protocol" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Neck series");
  await page.getByLabel("Body region").selectOption("OTHER");
  await page.getByLabel("View 1 name").fill("Front");
  await page.getByLabel("Key").nth(0).fill("FRONT");
  await page.getByRole("button", { name: "Add a view" }).click();
  await page.getByLabel("View 2 name").fill("Left profile");
  await page.getByLabel("Key").nth(1).fill("left_profile");
  await page.getByRole("button", { name: "Save draft" }).click();

  const detail = page.getByRole("article");
  await expect(detail.getByRole("heading", { name: "Neck series" })).toBeVisible();
  await expect(detail.getByText("Draft", { exact: true })).toBeVisible();
  await expect(detail.getByText("LEFT_PROFILE")).toBeVisible();
  await detail.getByRole("button", { name: "Activate" }).click();
  await detail.getByRole("group").getByRole("button", { name: "Activate" }).click();
  await expect(detail.getByText("Active", { exact: true })).toBeVisible();
  // Active protocols are frozen: only a new version or retirement is offered.
  await expect(detail.getByRole("button", { name: "Edit draft" })).toHaveCount(0);

  await detail.getByRole("button", { name: "Create a new version" }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(detail.getByRole("heading", { name: "Neck series (new version)" })).toBeVisible();
  await detail.getByRole("button", { name: "Activate" }).click();
  await detail.getByRole("group").getByRole("button", { name: "Activate" }).click();
  await expect(detail.getByText("Active", { exact: true })).toBeVisible();

  await page.getByLabel("Status").selectOption("RETIRED");
  await expect(page.getByRole("button", { name: "Neck series", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByRole("cell", { name: /Configuration changed/i }).first()).toBeVisible();
});

// Layer 2 (M2.10, ADR-0023 K2-17 to K2-19): a flag for the organization, a
// practice's offline policy, and a recorded retention policy.
test("changes a feature, a practice's offline policy and records a retention policy", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Configuration" }).click();
  await expect(page.getByRole("heading", { name: "Configuration" })).toBeVisible();

  const ghost = page.getByRole("listitem").filter({ hasText: "photography.ghostOverlay" });
  await expect(ghost.getByText("On", { exact: true })).toBeVisible();
  await expect(ghost.getByText("Default", { exact: true })).toBeVisible();
  await ghost.getByRole("button", { name: "Turn off" }).click();
  await expect(ghost.getByText("Off", { exact: true })).toBeVisible();
  await expect(ghost.getByText(/Set for the organization/)).toBeVisible();

  await page.getByLabel("Settings for").selectOption({ label: "Synthetic Demo Practice" });
  await expect(page.getByLabel("Days kept")).toHaveValue("7");
  await page.getByLabel("Days kept").fill("5");
  await page.getByRole("button", { name: "Save offline policy" }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();
  await expect(page.getByLabel("Days kept")).toHaveValue("5");

  await page.getByRole("button", { name: "Record a policy" }).click();
  await page.getByLabel("Kept for (days)").fill("3650");
  await page.getByLabel("Then").selectOption("ARCHIVE");
  await page.getByLabel("Basis").fill("Records schedule RS-1");
  await page.getByRole("button", { name: "Record policy" }).click();
  const row = page.getByRole("row", { name: /Clinical photo/ });
  await expect(row).toContainText("3650 days");
  await expect(row).toContainText("Archive");
});

// Layer 4 (M4.1, ADR-0028 K4-03, ADR-0029): an empty catalog, a category tree
// with a priced treatment, and retiring that refuses to hide active entries.
test("builds the treatment catalog and retires entries", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Treatment catalog" }).click();
  await expect(page.getByRole("heading", { name: "Treatment catalog" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The catalog is empty" })).toBeVisible();

  await page.getByRole("button", { name: "New category" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Injectables");
  await page.getByRole("button", { name: "Save category" }).click();
  const detail = page.getByRole("article");
  await expect(detail.getByRole("heading", { name: "Injectables" })).toBeVisible();

  await detail.getByRole("button", { name: "Add a subcategory" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Fillers");
  await expect(page.getByLabel("Inside")).toHaveValue(/.+/);
  await page.getByRole("button", { name: "Save category" }).click();
  await expect(detail.getByText("In Injectables")).toBeVisible();

  await detail.getByRole("button", { name: "Add a treatment" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Lip filler");
  await page.getByLabel("Code").fill("LIP-1");
  await page.getByLabel("Pricing unit").fill("syringe");
  await page.getByLabel("Default unit price (USD)").fill("450");
  await page.getByRole("button", { name: "Save treatment" }).click();
  const row = detail.getByRole("row", { name: /Lip filler/ });
  await expect(row).toContainText("$450.00");
  await expect(row).toContainText("LIP-1");

  // A category with an active treatment cannot be retired; the server says why.
  await detail.getByRole("button", { name: "Retire category" }).click();
  await detail.getByRole("group").getByRole("button", { name: "Retire" }).click();
  await expect(detail.getByRole("alert")).toContainText("Retire or move this category's active treatments");

  await row.getByRole("button", { name: "Retire treatment" }).click();
  await row.getByRole("group").getByRole("button", { name: "Retire" }).click();
  await expect(detail.getByRole("heading", { name: "No treatments here" })).toBeVisible();
  await page.getByLabel("Show retired entries").check();
  await expect(detail.getByRole("row", { name: /Lip filler/ })).toContainText("Retired");

  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByRole("cell", { name: /Configuration changed/i }).first()).toBeVisible();
});

test("adds a passkey and signs in with it", async ({ page }) => {
  // Chromium's virtual authenticator stands in for Touch ID or a security key.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });

  await signIn(page);
  await page.getByRole("link", { name: /Demo Admin|admin@synthetic-demo.test/ }).click();
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByText("Passkey added.")).toBeVisible();
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials).toHaveLength(1);

  // The next sign-in offers the passkey instead of a code.
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(stack.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Use a passkey" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  const after = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(after.credentials[0]?.signCount).toBeGreaterThan(0);
});
