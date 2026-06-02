import { expect, test, type Browser } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

type RoleAuthSeed = {
  role: string;
  email: string;
  password: string;
  storagePath: string;
};

function resolveRoleSeeds(): RoleAuthSeed[] {
  const email = process.env.PLAYWRIGHT_EMAIL;
  const password = process.env.PLAYWRIGHT_PASSWORD;

  if (email && password) {
    return [
      {
        role: "user",
        email,
        password,
        storagePath: path.resolve(process.cwd(), "playwright", ".auth", "user.json"),
      },
    ];
  }

  return [];
}

async function signInAndSaveState(
  browser: Browser,
  seed: RoleAuthSeed,
): Promise<void> {
  fs.mkdirSync(path.dirname(seed.storagePath), { recursive: true });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/auth/login");
  await page.getByPlaceholder("you@example.com").fill(seed.email);
  await page.getByPlaceholder("Enter your password").fill(seed.password);
  await page.getByRole("button", { name: "Log In" }).click();

  const verificationGateVisible = await page
    .getByRole("heading", { name: "Verify your email" })
    .isVisible()
    .catch(() => false);

  if (verificationGateVisible) {
    throw new Error(
      `The ${seed.role} account requires email verification. Complete verification first, then run pw:auth again.`,
    );
  }

  await page.waitForURL(/\/(dashboard|welcome)/, { timeout: 45_000 });
  await expect(page).toHaveURL(/\/(dashboard|welcome)/);

  await context.storageState({ path: seed.storagePath });
  await context.close();
}

test("authenticate and save role-based auth states", async ({ browser }) => {
  test.setTimeout(
    Number(process.env.PLAYWRIGHT_AUTH_SETUP_TIMEOUT_MS ?? "600000"),
  );

  const seeds = resolveRoleSeeds();
  if (seeds.length === 0) {
    throw new Error(
      "No Playwright credentials found. Set PLAYWRIGHT_EMAIL and PLAYWRIGHT_PASSWORD in web/.env.",
    );
  }

  const failures: string[] = [];
  for (const seed of seeds) {
    try {
      await signInAndSaveState(browser, seed);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Unknown error (${seed.role})`;
      failures.push(`${seed.role}: ${message}`);
    }
  }

  if (failures.length > 0) {
    if (process.env.PLAYWRIGHT_AUTH_ALLOW_PARTIAL === "1") {
      console.warn(
        `Auth setup partial success; failures:\n- ${failures.join("\n- ")}`,
      );
      return;
    }
    throw new Error(
      `Auth setup failed for some roles:\n- ${failures.join("\n- ")}`,
    );
  }
});
