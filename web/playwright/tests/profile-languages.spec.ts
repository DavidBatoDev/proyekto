import { test, expect, type Page } from "@playwright/test";

// Build the Supabase localStorage key from the env var that playwright.config.ts already loads.
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
  if (!raw)
    throw new Error(
      `Supabase auth token not found in localStorage (key: sb-${SUPABASE_REF}-auth-token)`,
    );
  const parsed = JSON.parse(raw);
  const record = Array.isArray(parsed) ? parsed[0] : parsed;
  const userId = record?.user?.id;
  if (!userId) throw new Error("Could not extract user.id from auth token");
  return `/profile/${userId}`;
}

async function deleteLanguageIfPresent(page: Page, langName: string) {
  const entry = page.locator("span").filter({ hasText: langName }).first();
  if (!(await entry.isVisible().catch(() => false))) return;

  // Hover the row to reveal the edit/delete buttons (opacity-0 → group-hover)
  await entry.hover();
  const deleteBtn = page
    .locator('[title="Delete"]')
    .filter({ hasNot: page.locator('[title="Delete Document"]') })
    .first();
  await deleteBtn.click();
  await expect(entry).not.toBeVisible({ timeout: 5_000 });
}

test.describe("Profile — Languages", () => {
  // Use an uncommon language to avoid collisions with real profile data.
  const LANG = "Welsh";
  const FLUENCY = "fluent";

  test.beforeEach(async ({ page }) => {
    const url = await resolveProfileUrl(page);
    await page.goto(url);
    await expect(page.locator("h3").filter({ hasText: "Languages" })).toBeVisible(
      { timeout: 15_000 },
    );
  });

  // --- Golden path ---------------------------------------------------------

  test("adds a language and it appears in the Languages section immediately", async ({
    page,
  }) => {
    // Clean up in case a previous run left this language behind.
    await deleteLanguageIfPresent(page, LANG);

    const langHeader = page
      .locator("h3")
      .filter({ hasText: "Languages" })
      .locator("xpath=..");
    const langCard = page
      .locator("h3")
      .filter({ hasText: "Languages" })
      .locator("xpath=../.."); // Card wrapping the whole section

    // Open "Add language" modal
    await langHeader.getByRole("button").click();
    await expect(
      page.getByRole("heading", { name: "Add language" }),
    ).toBeVisible();

    // Save must be disabled before a language is selected
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

    // Search for and pick the language from the dropdown
    await page.getByPlaceholder("Search language...").fill(LANG);
    await page.getByRole("button", { name: LANG }).click();

    // Set proficiency
    await page.locator("select").selectOption(FLUENCY);

    // Submit — this is the action that the bug report says doesn't work
    await page.getByRole("button", { name: "Save" }).click();

    // Modal must close
    await expect(
      page.getByRole("heading", { name: "Add language" }),
    ).not.toBeVisible();

    // Language and proficiency must appear in the card without a reload
    await expect(langCard.getByText(LANG)).toBeVisible();
    await expect(langCard.getByText(FLUENCY)).toBeVisible();

    // --- Teardown: remove so re-runs start clean ---
    await deleteLanguageIfPresent(page, LANG);
  });

  // --- Edge cases ----------------------------------------------------------

  test("Save button stays disabled when text is typed but not selected from dropdown", async ({
    page,
  }) => {
    await page
      .locator("h3")
      .filter({ hasText: "Languages" })
      .locator("xpath=..")
      .getByRole("button")
      .click();
    await expect(
      page.getByRole("heading", { name: "Add language" }),
    ).toBeVisible();

    // Still disabled after typing without selecting
    await page.getByPlaceholder("Search language...").fill("Spanish");
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

    // Enabled only after choosing from the dropdown
    await page.getByRole("button", { name: "Spanish" }).click();
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  test("Cancel closes modal without saving", async ({ page }) => {
    const langCard = page
      .locator("h3")
      .filter({ hasText: "Languages" })
      .locator("xpath=../..");

    await page
      .locator("h3")
      .filter({ hasText: "Languages" })
      .locator("xpath=..")
      .getByRole("button")
      .click();
    await page.getByPlaceholder("Search language...").fill("French");
    await page.getByRole("button", { name: "French" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(
      page.getByRole("heading", { name: "Add language" }),
    ).not.toBeVisible();
    await expect(langCard.getByText("French")).not.toBeVisible();
  });
});
