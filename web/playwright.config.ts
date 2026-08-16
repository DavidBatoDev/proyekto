import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function loadEnvFromWebEnvFile(): void {
  const envPath = path.resolve(process.cwd(), ".env.development.local");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    // Strip surrounding quotes the way dotenv does. Without this a quoted
    // value ships its quote characters as part of the secret, which surfaces
    // as an ordinary "wrong password" login timeout rather than a parse error
    // — a genuinely confusing failure, since the file looks correct.
    if (value.length >= 2 && /^(".*"|'.*')$/s.test(value)) {
      value = value.slice(1, -1);
    }
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
    {
      name: "engine-setup",
      testDir: "./playwright",
      testMatch: /engine\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    {
      // The same specs, run against the in-house DOM+SVG canvas engine.
      //
      // No spec file knows this project exists: the engine is selected by the
      // localStorage key the resolver already reads, and every canvas assertion
      // is written against shell-emitted testids rather than renderer internals.
      // That is the whole payoff of the engine-neutral locators — parity is
      // checked by re-running the existing suite, not by maintaining a second one.
      name: "chromium-user-domsvg",
      testMatch: /(roadmap-canvas|canvas-perf).*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "./playwright/.auth/user-domsvg.json",
      },
      dependencies: ["engine-setup"],
    },
  ],
});
