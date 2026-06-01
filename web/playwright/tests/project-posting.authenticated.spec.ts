import { expect, test, type Page } from "@playwright/test";

async function goToStep3(page: Page) {
  await page.goto("/project-posting");
  await expect(page).toHaveURL(/\/project-posting/);

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByRole("heading", { name: "Step 3: Budget & Timeline" }),
  ).toBeVisible();
}

test.describe("Project posting (authenticated)", () => {
  test("shows inline validation on invalid custom budget/start-date submit", async ({
    page,
  }) => {
    await goToStep3(page);

    // Select custom budget with empty amount
    await page.locator('input[name="budgetRange"]').nth(4).check();
    await page.getByPlaceholder("Enter Custom Amount").fill("");

    // Select custom start date with empty date
    await page.locator('input[name="startDate"]').nth(2).check();
    await page.getByPlaceholder("DD/MM/YY").fill("");

    await page.getByRole("button", { name: "Submit project" }).click();

    await expect(
      page.getByText(
        "Please correct the highlighted fields before submitting your project.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Please enter a custom budget amount."),
    ).toBeVisible();
    await expect(page.getByText("Please pick a custom start date.")).toBeVisible();
    await expect(page).toHaveURL(/\/project-posting/);
  });

  test("create flow redirects to overview (optional)", async ({ page }) => {
    test.skip(
      process.env.PLAYWRIGHT_RUN_CREATE_FLOW !== "1",
      "Set PLAYWRIGHT_RUN_CREATE_FLOW=1 to execute real create flow.",
    );

    await goToStep3(page);
    await page.getByRole("button", { name: "Submit project" }).click();

    await page.waitForURL(/\/project\/.+\/overview/, { timeout: 45_000 });
    await expect(page).toHaveURL(/\/project\/.+\/overview/);
  });
});
