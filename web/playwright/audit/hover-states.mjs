/**
 * Probes visible legacy light hover utilities on every URL captured by the
 * dark-theme route audit. Run the screenshot audit first so dynamic entity
 * URLs are available in its manifest.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(process.cwd(), "pw-theme-audit-dark");
const MANIFEST = path.join(ROOT, "manifest.json");
const STORAGE = path.resolve(process.cwd(), "playwright", ".auth", "user.json");
const REPORT = path.join(ROOT, "hover-report.json");
const SCREENSHOT_DIR = path.join(ROOT, "hover-failures");
const LEGACY_HOVER_TOKENS = new Set([
	"hover:bg-white",
	"hover:bg-white/70",
	"hover:bg-white/80",
	"hover:bg-gray-50",
	"hover:bg-gray-100",
	"hover:bg-slate-50",
	"hover:bg-slate-100",
]);

if (!fs.existsSync(MANIFEST)) {
	throw new Error("Run npm run pw:audit:dark before the hover-state audit.");
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const urls = [
	...new Set(
		manifest.rows
			.filter((row) => row.status === "captured" && row.viewport === "desktop")
			.map((row) => row.finalUrl)
			.filter(Boolean),
	),
];

const isUnexpectedlyLight = (background) => {
	const match = background.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
	if (!match) return false;
	const [, red, green, blue] = match.map(Number);
	return red > 225 && green > 225 && blue > 225;
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	storageState: STORAGE,
	viewport: { width: 1440, height: 900 },
});
await context.addInitScript(() => {
	sessionStorage.setItem("proyekto.theme-audit", "dark");
});
const page = await context.newPage();
const results = [];

for (const url of urls) {
	await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(
		() => undefined,
	);
	await page.waitForTimeout(700);
	const candidates = page.locator('[class*="hover:bg-"]');
	const count = Math.min(await candidates.count(), 80);
	let probed = 0;
	const failures = [];

	for (let index = 0; index < count; index += 1) {
		const candidate = candidates.nth(index);
		if (!(await candidate.isVisible().catch(() => false))) continue;
		const tokens = await candidate
			.evaluate((element) => [...element.classList])
			.catch(() => []);
		if (!tokens.some((token) => LEGACY_HOVER_TOKENS.has(token))) continue;
		await candidate.hover({ timeout: 1500 }).catch(() => undefined);
		const background = await candidate
			.evaluate((element) => getComputedStyle(element).backgroundColor)
			.catch(() => "unavailable");
		probed += 1;
		if (isUnexpectedlyLight(background)) {
			failures.push({ index, tokens, background });
		}
	}

	if (failures.length > 0) {
		fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
		const slug = new URL(url).pathname.replace(/^\/+|\/+$/g, "").replaceAll("/", "_") || "root";
		await page.screenshot({
			path: path.join(SCREENSHOT_DIR, `${slug}.png`),
			fullPage: true,
		});
	}
	results.push({ url, probed, failures });
	console.log(`[hover] ${failures.length ? "FAILED" : "passed"} ${url} (${probed} probed)`);
}

await browser.close();
const report = {
	capturedAt: new Date().toISOString(),
	theme: "dark",
	routes: results.length,
	probed: results.reduce((total, result) => total + result.probed, 0),
	failures: results.reduce((total, result) => total + result.failures.length, 0),
	results,
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log("[hover] summary", {
	routes: report.routes,
	probed: report.probed,
	failures: report.failures,
});
if (report.failures > 0) process.exitCode = 1;
