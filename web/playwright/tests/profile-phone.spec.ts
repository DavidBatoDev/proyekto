import { test, expect, type Page } from "@playwright/test";

const SUPABASE_REF = (() => {
  try {
    return new URL(process.env.VITE_SUPABASE_URL ?? "").hostname.split(".")[0];
  } catch {
    return "";
  }
})();

async function resolveProfileUrl(page: Page): Promise<string> {
  await page.goto("/dashboard");
  const raw = await page.evaluate(
    (key) => localStorage.getItem(key),
    `sb-${SUPABASE_REF}-auth-token`,
  );
  if (!raw) throw new Error("Supabase auth token not found in localStorage");
  const parsed = JSON.parse(raw);
  const record = Array.isArray(parsed) ? parsed[0] : parsed;
  const userId = record?.user?.id;
  if (!userId) throw new Error("Could not extract user.id from auth token");
  return `/profile/${userId}`;
}

test.describe("Profile — Phone Number", () => {
  test.beforeEach(async ({ page }) => {
    const url = await resolveProfileUrl(page);
    await page.goto(url);
    await expect(
      page.locator("h3").filter({ hasText: "Contact Info" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('existing phone number shows "Unverified" badge', async ({ page }) => {
    const contactCard = page
      .locator("h3")
      .filter({ hasText: "Contact Info" })
      .locator("xpath=../..");

    const hasPhone = await contactCard
      .locator("span")
      .filter({ hasText: /^\+/ })
      .isVisible()
      .catch(() => false);

    if (!hasPhone) {
      test.skip();
      return;
    }

    await expect(contactCard.getByText("Unverified")).toBeVisible();
  });

  test('saves a valid phone number and "Unverified" badge appears', async ({
    page,
  }) => {
    const contactHeader = page
      .locator("h3")
      .filter({ hasText: "Contact Info" })
      .locator("xpath=..");
    const contactCard = page
      .locator("h3")
      .filter({ hasText: "Contact Info" })
      .locator("xpath=../..");

    // Open contact edit (pencil button in the header)
    await contactHeader.getByRole("button").click();

    // Fill valid E.164 phone number
    await page.locator('input[name="phone_number"]').fill("+639123456789");

    // Save
    await contactCard.getByRole("button", { name: "Save" }).click();

    // Phone appears and badge is shown
    await expect(contactCard.getByText("+639123456789")).toBeVisible({
      timeout: 10_000,
    });
    await expect(contactCard.getByText("Unverified")).toBeVisible();
  });
});
