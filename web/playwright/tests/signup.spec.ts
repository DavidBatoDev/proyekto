import { test, expect, type Page } from "@playwright/test";

// ── Credentials ──────────────────────────────────────────────────────────────
const CLIENT_EMAIL = "davidenriquez380@gmail.com";
const CLIENT_PASSWORD = "Admin123$";
const FIRST_NAME = "David";
const LAST_NAME = "Enriquez";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function signOut(page: Page) {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  // Open user menu (aria-label="User menu")
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("button", { name: "Logout" }).click();
  // Wait until we leave the dashboard
  await page.waitForURL((u) => !u.pathname.startsWith("/dashboard"), {
    timeout: 10_000,
  });
}

async function fillAccountStep(
  page: Page,
  email: string,
  first = FIRST_NAME,
  last = LAST_NAME,
) {
  await page.locator('input[autocomplete="given-name"]').fill(first);
  await page.locator('input[autocomplete="family-name"]').fill(last);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('button[type="submit"]').filter({ hasText: /Continue/ }).click();
}

async function fillPasswordStep(page: Page, password: string) {
  const inputs = page.locator('input[type="password"]');
  await inputs.first().fill(password);
  await inputs.last().fill(password);
  await page.getByRole("button", { name: /Continue/ }).click();
}

async function fillProfileStep(page: Page) {
  // Step 4 — all fields optional except Terms checkbox
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: /Create Account/ }).click();
}

async function waitForEmailVerification(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Verify your email" }),
  ).toBeVisible({ timeout: 15_000 });

  // ⏸ Pause: the browser window is open — enter the 6-digit OTP manually,
  //    then click "Verify Code". The test resumes automatically on redirect.
  console.log(
    "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "\n  CHECK YOUR EMAIL — enter the 6-digit code in the",
    "\n  browser window and click \"Verify Code\" to continue.",
    "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n",
  );

  // Wait up to 5 minutes for the user to enter the code and land on /welcome
  await page.waitForURL(/\/welcome/, { timeout: 5 * 60 * 1000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Signup Flow", () => {
  test.beforeEach(async ({ page }) => {
    await signOut(page);
  });

  // ── Client / Freelancer lane ──────────────────────────────────────────────

  test("client/freelancer lane — signup through welcome to dashboard", async ({
    page,
  }) => {
    test.setTimeout(10 * 60 * 1000); // 10 min — manual OTP entry needed
    await page.goto("/auth/signup");

    // Step 1 — lane selection
    await page.getByText("I'm a client or freelancer").click();
    await expect(
      page.getByText("I'm a client or freelancer"),
    ).toBeVisible(); // card selected
    await page.getByRole("button", { name: /Continue/ }).click();

    // Step 2 — account
    await expect(
      page.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
    await fillAccountStep(page, CLIENT_EMAIL);

    // Step 3 — password
    await expect(
      page.getByRole("heading", { name: "Set a password" }),
    ).toBeVisible();
    await fillPasswordStep(page, CLIENT_PASSWORD);

    // Step 4 — profile
    await expect(
      page.getByRole("heading", { name: "Tell us a bit about you" }),
    ).toBeVisible();
    await fillProfileStep(page);

    // Step 5 — email OTP (manual input required)
    await waitForEmailVerification(page);

    // ── /welcome — client/freelancer deck (4 slides) ──────────────────────

    // Slide 1: Welcome
    await expect(page.getByText(/Welcome to Proyekto/)).toBeVisible();
    await page.getByRole("button", { name: /Get started/ }).click();

    // Slide 2: What you can do here
    await expect(
      page.getByRole("heading", { name: "What you can do here" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Next/ }).click();

    // Slide 3: Workspace name — type a real name
    await expect(
      page.getByRole("heading", { name: "Your workspace is ready" }),
    ).toBeVisible();
    const workspaceInput = page.locator('input[placeholder="My Workspace"]').or(
      page.locator("input").filter({ hasNot: page.locator('[type="email"]') }).last(),
    );
    await workspaceInput.fill("Proyekto Test Workspace");
    await page.getByRole("button", { name: /Next/ }).click();

    // Slide 4: Invite a team member then finish
    await expect(
      page.getByRole("heading", { name: "Invite your team" }),
    ).toBeVisible();
    const inviteInput = page.getByPlaceholder("teammate@company.com");
    await inviteInput.fill("testinvite@proyekto.tech");
    // Send the invite
    await page.getByRole("button", { name: /Send.*invite.*finish/i }).click();

    // Should land on /dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  // ── Consultant lane ───────────────────────────────────────────────────────

  test("consultant lane — signup through welcome to application", async ({
    page,
  }) => {
    test.setTimeout(10 * 60 * 1000); // 10 min — manual OTP entry needed
    // Delete davidenriquez380@gmail.com from Supabase Auth before running this.
    await page.goto("/auth/signup");

    // Step 1 — consultant lane
    await page.getByText("I'm applying as a consultant").click();
    await page.getByRole("button", { name: /Continue/ }).click();

    // Step 2 — account
    await expect(
      page.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
    await fillAccountStep(page, CLIENT_EMAIL);

    // Step 3 — password
    await fillPasswordStep(page, CLIENT_PASSWORD);

    // Step 4 — profile
    await fillProfileStep(page);

    // Step 5 — email OTP (manual input required)
    await waitForEmailVerification(page);

    // ── /welcome — consultant deck (3 slides) ────────────────────────────

    // Slide 1: Welcome
    await expect(page.getByText(/Welcome to Proyekto/)).toBeVisible();
    await page.getByRole("button", { name: /Get started/ }).click();

    // Slide 2: What you're applying for
    await expect(
      page.getByRole("heading", { name: "What you're applying for" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Next/ }).click();

    // Slide 3: What to expect
    await expect(
      page.getByRole("heading", { name: "What to expect" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Start application/ }).click();

    // Should leave /welcome
    await expect(page).not.toHaveURL(/\/welcome/, { timeout: 15_000 });
  });
});
