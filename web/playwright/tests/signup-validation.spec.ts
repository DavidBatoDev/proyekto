import { test, expect, type Page } from "@playwright/test";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Clear the Supabase auth token from localStorage so the app initializes as
 * a logged-out guest on the next navigation (avoids redirect to /dashboard).
 */
async function clearAuth(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
}

/** Navigate to Step 2 (Account Info) via the client/freelancer lane. */
async function goToAccountStep(page: Page) {
  await clearAuth(page);
  await page.goto("/auth/signup");
  await page.getByText("I'm a client or freelancer").click();
  // Lane step uses type="button" (not inside a <form>); use role selector instead.
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible({ timeout: 10_000 });
}

/** Fill Step 2 with valid data and proceed to Step 3 (Password). */
async function goToPasswordStep(page: Page) {
  await goToAccountStep(page);
  await page.locator('input[autocomplete="given-name"]').fill("Test");
  await page.locator('input[autocomplete="family-name"]').fill("User");
  await page.locator('input[type="email"]').fill("valid@example.com");
  await page.locator('button[type="submit"]').filter({ hasText: /Continue/ }).click();
  await expect(
    page.getByRole("heading", { name: "Set a password" }),
  ).toBeVisible({ timeout: 10_000 });
}

// ── Shared button locator ─────────────────────────────────────────────────────

function continueBtn(page: Page) {
  return page.locator('button[type="submit"]').filter({ hasText: /Continue/ });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Signup Validation", () => {

  // ── Step 2: Account Info ──────────────────────────────────────────────────

  test.describe("Step 2 — Account Info", () => {
    test("Continue button is disabled when fields are empty", async ({ page }) => {
      await goToAccountStep(page);
      await expect(continueBtn(page)).toBeDisabled();
    });

    test("shows inline errors when submitting empty fields", async ({ page }) => {
      await goToAccountStep(page);

      // Blur each empty field to trigger per-field errors
      await page.locator('input[autocomplete="given-name"]').focus();
      await page.locator('input[autocomplete="given-name"]').blur();
      await expect(page.getByText("First name is required")).toBeVisible();

      await page.locator('input[autocomplete="family-name"]').focus();
      await page.locator('input[autocomplete="family-name"]').blur();
      await expect(page.getByText("Last name is required")).toBeVisible();

      await page.locator('input[type="email"]').focus();
      await page.locator('input[type="email"]').blur();
      await expect(page.getByText("Email is required")).toBeVisible();
    });

    test("rejects invalid email format", async ({ page }) => {
      await goToAccountStep(page);

      await page.locator('input[type="email"]').fill("notanemail");
      await page.locator('input[type="email"]').blur();
      await expect(page.getByText("Enter a valid email address")).toBeVisible();
      await expect(continueBtn(page)).toBeDisabled();
    });

    test("clears email error when field becomes valid", async ({ page }) => {
      await goToAccountStep(page);

      await page.locator('input[type="email"]').fill("bad");
      await page.locator('input[type="email"]').blur();
      await expect(page.getByText("Enter a valid email address")).toBeVisible();

      // Fix it — error should disappear
      await page.locator('input[type="email"]').fill("valid@example.com");
      await expect(page.getByText("Enter a valid email address")).not.toBeVisible();
    });

    test("Continue button enables when all fields are valid", async ({ page }) => {
      await goToAccountStep(page);

      await page.locator('input[autocomplete="given-name"]').fill("Test");
      await page.locator('input[autocomplete="family-name"]').fill("User");
      await page.locator('input[type="email"]').fill("valid@example.com");

      await expect(continueBtn(page)).toBeEnabled();
    });
  });

  // ── Step 3: Password ──────────────────────────────────────────────────────

  test.describe("Step 3 — Password", () => {
    test("Continue button is disabled when password fields are empty", async ({ page }) => {
      await goToPasswordStep(page);
      await expect(continueBtn(page)).toBeDisabled();
    });

    test("blocks weak password and shows hint", async ({ page }) => {
      await goToPasswordStep(page);

      // All-digits password is score 1 — "Weak"
      await page.locator('input[autocomplete="new-password"]').first().fill("12345678");

      await expect(
        page.getByText("Add uppercase letters, numbers, or symbols to continue"),
      ).toBeVisible();
      await expect(continueBtn(page)).toBeDisabled();
    });

    test("unlocks Continue when password reaches Fair strength and confirm matches", async ({
      page,
    }) => {
      await goToPasswordStep(page);

      // "Fair" = length + uppercase + lowercase (score 3)
      await page.locator('input[autocomplete="new-password"]').first().fill("Password1");

      await expect(
        page.getByText("Add uppercase letters, numbers, or symbols to continue"),
      ).not.toBeVisible();
      // Button still disabled — confirm field is empty
      await expect(continueBtn(page)).toBeDisabled();

      // Fill matching confirm
      await page.locator('input[autocomplete="new-password"]').last().fill("Password1");
      await expect(continueBtn(page)).toBeEnabled();
    });

    test("shows mismatch error on confirm blur", async ({ page }) => {
      await goToPasswordStep(page);

      await page.locator('input[autocomplete="new-password"]').first().fill("Password1!");
      await page.locator('input[autocomplete="new-password"]').last().fill("Different1!");
      await page.locator('input[autocomplete="new-password"]').last().blur();

      await expect(page.getByText("Passwords do not match")).toBeVisible();
      await expect(continueBtn(page)).toBeDisabled();
    });

    test("clears mismatch error when confirm matches", async ({ page }) => {
      await goToPasswordStep(page);

      await page.locator('input[autocomplete="new-password"]').first().fill("Password1!");
      await page.locator('input[autocomplete="new-password"]').last().fill("Different1!");
      await page.locator('input[autocomplete="new-password"]').last().blur();
      await expect(page.getByText("Passwords do not match")).toBeVisible();

      // Fix confirm — error clears and button enables
      await page.locator('input[autocomplete="new-password"]').last().fill("Password1!");
      await expect(page.getByText("Passwords do not match")).not.toBeVisible();
      await expect(continueBtn(page)).toBeEnabled();
    });
  });
});
