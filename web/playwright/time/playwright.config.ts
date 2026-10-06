import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the time persona harness (W1-12, Phase C). Run from web/:
 *
 *   node playwright/time/seed-time-personas.mjs                 # seed the dev DB first
 *   npx playwright test -c playwright/time/playwright.config.ts # sign in every persona, then the specs
 *   node playwright/time/seed-time-personas.mjs --teardown      # afterwards
 *
 * Targets the Phase C web (TIME_E2E_BASE_URL, default http://localhost:3107, started with
 * VITE_API_URL=http://localhost:8011). PLAYWRIGHT_BASE_URL is deliberately ignored: it usually
 * names the main checkout's dev server, which runs different code.
 *
 *   TIME_E2E_PERSONAS=member,lead   sign in only these personas
 *   TIME_E2E_AUTH_MAX_AGE_MIN=45    reuse a saved session younger than this (default 45)
 *   TIME_E2E_HEADED=1               headed, with TIME_E2E_SLOW_MO=<ms>
 */

// Tells playwright/tests/time/timePersonas.ts that this is a live run (the default config skips the specs).
process.env.PROYEKTO_TIME_E2E = "1";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const baseURL = (process.env.TIME_E2E_BASE_URL ?? "http://localhost:3107").replace(/\/+$/, "");
if (!LOCAL_HOSTS.has(new URL(baseURL).hostname)) {
	throw new Error(
		`TIME_E2E_BASE_URL must be a local web (got ${baseURL}); the seeded personas exist only on the dev database.`,
	);
}
const headed = process.env.TIME_E2E_HEADED === "1";
const slowMo = process.env.TIME_E2E_SLOW_MO ? Number(process.env.TIME_E2E_SLOW_MO) : undefined;

export default defineConfig({
	testDir: "../tests/time",
	outputDir: "../test-results/time",
	// The flows change shared seeded state (submit, return, approve), so one worker, in file order.
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: "list",
	timeout: 120_000,
	expect: { timeout: 15_000 },
	use: {
		baseURL,
		headless: !headed,
		launchOptions: { slowMo },
		// The seed writes Asia/Manila weeks and preferences; the browser must agree.
		timezoneId: "Asia/Manila",
		locale: "en-US",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "time-setup",
			testDir: ".",
			testMatch: /personas\.setup\.ts$/,
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "time-desktop",
			testIgnore: /mobile\.spec\.ts$/,
			use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
			dependencies: ["time-setup"],
		},
		{
			name: "time-mobile",
			testMatch: /mobile\.spec\.ts$/,
			// Chromium phone emulation at the Phase C size (390×844).
			use: {
				...devices["Pixel 7"],
				viewport: { width: 390, height: 844 },
				isMobile: true,
				hasTouch: true,
			},
			dependencies: ["time-setup"],
		},
	],
});
