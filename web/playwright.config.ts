import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function loadEnvFromWebEnvFile(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFromWebEnvFile();

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const headed = process.env.PLAYWRIGHT_HEADED === "1";
const slowMo = process.env.PLAYWRIGHT_SLOW_MO ? Number(process.env.PLAYWRIGHT_SLOW_MO) : undefined;

export default defineConfig({
  testDir: "./playwright/tests",
  outputDir: "./playwright/test-results",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    headless: !headed,
    launchOptions: { slowMo },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testDir: "./playwright",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-user",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "./playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
});
