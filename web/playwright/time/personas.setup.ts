import { type Browser, expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
	DEV_SUPABASE_HOST,
	loadTimeSeed,
	personaStatePath,
	type TimeSeedManifest,
	type TimeSeedPersona,
	timeSeedPath,
} from "../tests/time/timePersonas";

/**
 * Signs every seeded time persona in through the login form and saves the session to
 * playwright/.auth/time-<persona>.json (W1-12). Runs as the `time-setup` project of
 * playwright/time/playwright.config.ts, before the persona specs.
 *
 * A session saved after the current seed and younger than TIME_E2E_AUTH_MAX_AGE_MIN (default
 * 45 minutes) is reused, which keeps re-runs under the Supabase sign-in rate limit.
 * TIME_E2E_PERSONAS=member,lead narrows the list.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_AGE_MS =
	Number(process.env.TIME_E2E_AUTH_MAX_AGE_MIN ?? "45") * 60_000;

function assertSafeTarget(
	seed: TimeSeedManifest | null,
	baseURL: string | undefined,
): asserts seed is TimeSeedManifest {
	if (!seed) {
		throw new Error(
			`No time seed manifest at ${timeSeedPath()}. Run node playwright/time/seed-time-personas.mjs first.`,
		);
	}
	if (seed.status !== "seeded") {
		throw new Error(
			`The time seed run ${seed.runId} is ${seed.status}; seed again (--replace) before signing in.`,
		);
	}
	if (seed.supabaseHost !== DEV_SUPABASE_HOST) {
		throw new Error(
			`The seed manifest names ${seed.supabaseHost}, not the dev project; refusing to sign in.`,
		);
	}
	const host = baseURL ? new URL(baseURL).hostname : "";
	if (!LOCAL_HOSTS.has(host)) {
		throw new Error(
			`Persona sign-in only runs against a local web (baseURL ${baseURL ?? "unset"}).`,
		);
	}
}

function wanted(seed: TimeSeedManifest): TimeSeedPersona[] {
	const only = (process.env.TIME_E2E_PERSONAS ?? "")
		.split(",")
		.map((key) => key.trim())
		.filter(Boolean);
	return Object.values(seed.personas)
		.filter((persona): persona is TimeSeedPersona => Boolean(persona))
		.filter((persona) => persona.login)
		.filter((persona) => only.length === 0 || only.includes(persona.key));
}

function isFresh(file: string, seededAt: string | null): boolean {
	try {
		const { mtimeMs } = fs.statSync(file);
		const afterSeed = seededAt ? mtimeMs > Date.parse(seededAt) : false;
		return afterSeed && Date.now() - mtimeMs < MAX_AGE_MS;
	} catch {
		return false;
	}
}

async function signIn(
	browser: Browser,
	baseURL: string,
	persona: TimeSeedPersona,
	statePath: string,
): Promise<void> {
	if (!persona.password) {
		throw new Error(
			`The manifest has no password for ${persona.key} (was the run torn down?).`,
		);
	}
	fs.mkdirSync(path.dirname(statePath), { recursive: true });
	const context = await browser.newContext({ baseURL });
	const page = await context.newPage();
	try {
		await page.goto("/auth/login");
		await page.getByPlaceholder("you@example.com").fill(persona.email);
		await page.getByPlaceholder("Enter your password").fill(persona.password);
		await page.getByRole("button", { name: "Log In" }).click();

		// The seed marks every profile verified and onboarded; either gate means the profile row is wrong.
		// Each waiter maps its own timeout to "timeout", so the losers never reject unhandled.
		const timeout = 45_000;
		const settle = (value: string) => [() => value, () => "timeout"] as const;
		const landed = await Promise.race([
			page
				.waitForURL(/\/dashboard(?:[/?#]|$)/, { timeout })
				.then(...settle("dashboard")),
			page
				.getByRole("heading", { name: "Verify your email" })
				.waitFor({ timeout })
				.then(...settle("the email verification step")),
			page
				.waitForURL(/\/welcome(?:[/?#]|$)/, { timeout })
				.then(...settle("/welcome")),
		]);
		if (landed === "timeout") {
			throw new Error(
				`${persona.key} did not reach /dashboard within ${timeout / 1000}s of signing in.`,
			);
		}
		if (landed !== "dashboard") {
			throw new Error(
				`${persona.key} landed on ${landed}: the seeded profile must have is_email_verified and has_completed_onboarding set.`,
			);
		}

		// The saved session must be this persona's, not a session left over in the tab.
		const email = await page.evaluate(() => {
			for (const key of Object.keys(window.localStorage)) {
				if (!key.endsWith("-auth-token")) continue;
				try {
					const value = JSON.parse(window.localStorage.getItem(key) ?? "null");
					if (value?.user?.email) return String(value.user.email);
				} catch {
					// not a session entry
				}
			}
			return null;
		});
		expect(email?.toLowerCase()).toBe(persona.email.toLowerCase());

		await context.storageState({ path: statePath });
	} finally {
		await context.close();
	}
}

test("sign in every seeded time persona", async ({ browser, baseURL }) => {
	test.setTimeout(10 * 60_000);
	const seed = loadTimeSeed();
	assertSafeTarget(seed, baseURL);

	const personas = wanted(seed);
	expect(personas.length, "no personas to sign in").toBeGreaterThan(0);

	const failures: string[] = [];
	for (const persona of personas) {
		const statePath = personaStatePath(persona.key);
		if (isFresh(statePath, seed.seededAt)) continue;
		try {
			await signIn(browser, baseURL as string, persona, statePath);
		} catch (error) {
			failures.push(
				`${persona.key}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (failures.length > 0) {
		throw new Error(`Persona sign-in failed:\n- ${failures.join("\n- ")}`);
	}
});
