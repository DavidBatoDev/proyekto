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
const hasConsultantAuth = Boolean(
  process.env.PLAYWRIGHT_CONSULTANT_EMAIL &&
    process.env.PLAYWRIGHT_CONSULTANT_PASSWORD,
);
const hasFreelancerAuth = Boolean(
  process.env.PLAYWRIGHT_FREELANCER_EMAIL &&
    process.env.PLAYWRIGHT_FREELANCER_PASSWORD,
);
const hasFallbackAuth =
  Boolean(process.env.PLAYWRIGHT_EMAIL && process.env.PLAYWRIGHT_PASSWORD) &&
  !hasConsultantAuth &&
  !hasFreelancerAuth;

const roleProjects: NonNullable<
  Parameters<typeof defineConfig>[0]["projects"]
> = [];

if (hasConsultantAuth || hasFreelancerAuth) {
  if (hasConsultantAuth) {
    roleProjects.push({
      name: "chromium-consultant",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "./playwright/.auth/consultant.json",
      },
      dependencies: ["setup"],
    });
  }

  if (hasFreelancerAuth) {
    roleProjects.push({
      name: "chromium-freelancer",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "./playwright/.auth/freelancer.json",
      },
      dependencies: ["setup"],
    });
  }
} else if (hasFallbackAuth) {
  roleProjects.push({
    name: "chromium-user",
    use: {
      ...devices["Desktop Chrome"],
      storageState: "./playwright/.auth/user.json",
    },
    dependencies: ["setup"],
  });
}

export default defineConfig({
  testDir: "./playwright/tests",
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
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testDir: "./playwright",
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        headless: process.env.PLAYWRIGHT_AUTH_HEADED === "1" ? false : true,
      },
    },
    ...roleProjects,
  ],
});
