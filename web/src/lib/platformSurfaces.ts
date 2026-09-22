import { stripWorkspacePrefix } from "./workspacePaths";

/**
 * Which paths the installed app shows, and where the rest go instead.
 *
 * The mobile app is free on both stores while the SaaS is paid on the web, so
 * the shell must carry no commerce surface at all: no prices, no checkout, no
 * upgrade button. The marketplace goes too — the app is the SaaS half of the
 * product only.
 *
 * This module is PURE: no Capacitor import, no platform read. Callers pass the
 * platform in, from `isNativeApp()` in `lib/platform.ts`. That is what makes
 * the whole gate testable without mocks, and it is the reason to keep it that
 * way.
 *
 * ## Default-deny
 *
 * An unclassified path is hidden on native. CI runs no tests on pull requests,
 * so a denylist would let a future `/checkout` route ship visible and silent.
 * This fails the other way: a new route nobody classified disappears from the
 * app and shows up as a bug report, which is a far cheaper mistake than a
 * rejected binary. `platformSurfaces.routes.test.ts` fails the moment a
 * generated route has no rule, so it should never reach a device.
 */

/** What kind of surface a path is, from the installed app's point of view. */
export type Surface =
	/** Shown in the app. */
	| "app"
	/** Sells something or shows a price. Hidden, with an explanation. */
	| "commerce"
	/** The marketplace half of the product. Hidden, with an explanation. */
	| "marketplace"
	/** The staff console. Hidden — it is a desktop tool. */
	| "staff"
	/** Hidden without explanation — the app's own chrome points here. */
	| "silent";

export const NATIVE_HOME_PATH = "/dashboard";
export const NOT_AVAILABLE_PATH = "/not-available";

/**
 * Longest-prefix-first, matched against the workspace-stripped path.
 *
 * Order matters the same way `legacyRoutePaths.ts` needs it to: a specific
 * path must beat a shorter one that is also a prefix of it.
 */
const SURFACE_RULES: ReadonlyArray<
	readonly [prefix: string, surface: Surface]
> = [
	// ── commerce ────────────────────────────────────────────────────────
	// Workspace settings, reached bare or under /w/<slug>/ — both shapes
	// arrive here already stripped.
	["/settings/billing", "commerce"],
	["/settings/usage", "commerce"],
	["/workspace/settings/billing", "commerce"],
	["/workspace/settings/usage", "commerce"],
	["/pricing", "commerce"],

	// ── marketplace ─────────────────────────────────────────────────────
	["/marketplace", "marketplace"],
	["/start-selling", "marketplace"],
	["/engagements", "marketplace"],
	["/brief", "marketplace"],
	// A legacy shim to /invites, but the path is marketplace-shaped and a
	// live database trigger still writes it into notifications.link_url.
	["/freelancer", "marketplace"],
	// The account-free client signing page. Nothing in the app can reach it
	// (there is no BROWSABLE intent-filter), so gating it costs nothing and
	// keeps the rule exception-free.
	["/contract/sign", "marketplace"],
	// The docs section about the marketplace. Listed BEFORE ["/docs", "app"]
	// below — rules are longest-prefix-first — so those articles inherit the
	// existing hide-with-explanation behaviour and the docs code needs no
	// special case of its own.
	["/docs/clients-and-marketplace", "marketplace"],

	// ── staff ───────────────────────────────────────────────────────────
	// The whole console, not page by page. Most of it is commerce (Plans,
	// Workspaces) or marketplace (Applications, Consultants, Match), its index
	// redirects into one of those, and it is a desktop tool besides — so a
	// half-visible admin area would just be a set of links that bounce.
	["/admin", "staff"],

	// ── app ─────────────────────────────────────────────────────────────
	["/auth", "app"],
	["/command-center", "app"],
	["/contact", "app"],
	["/dashboard", "app"],
	// Help content, useful on a phone. Its plan articles name what each tier
	// includes and link out for numbers, so it carries no price.
	["/docs", "app"],
	["/get-started", "app"],
	["/inbox", "app"],
	["/invites", "app"],
	["/meetings", "app"],
	["/notifications", "app"],
	["/not-available", "app"],
	["/oauth", "app"],
	["/onboarding", "app"],
	["/product", "silent"],
	["/profile", "app"],
	["/project", "app"],
	["/roadmap-templates", "app"],
	["/roadmap", "app"],
	["/settings", "app"],
	["/task-board", "app"],
	["/teams", "app"],
	["/unsubscribe", "app"],
	["/welcome", "app"],
	["/work-items", "app"],
	["/workspace", "app"],
];

function withoutSuffix(path: string): string {
	const cut = path.search(/[?#]/);
	return cut === -1 ? path : path.slice(0, cut);
}

/** A prefix only matches at a segment boundary: `/brief` must not eat `/briefly`. */
function isUnder(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * What kind of surface this path is. `null` means nobody has decided — which
 * the app treats as hidden; see the default-deny note above.
 *
 * Takes a runtime pathname (`/w/acme/settings/billing`) or a generated route
 * template (`/w/$workspaceSlug/settings/billing`) — the workspace prefix is
 * stripped either way, so both spellings land on one rule.
 */
export function classifySurface(path: string): Surface | null {
	const pathname = withoutSuffix(path);

	// The marketing landing, under either of its two paths. Not a surface
	// anyone navigated to on purpose — the in-app brand mark points at /home —
	// so it is sent home without an explanation.
	if (pathname === "/" || pathname === "/home") return "silent";

	const stripped = stripWorkspacePrefix(pathname);

	// Bare `/w/<slug>`: its own route forwards to that workspace's dashboard,
	// and it should keep the slug rather than be flattened here.
	if (stripped === "/") return "app";

	for (const [prefix, surface] of SURFACE_RULES) {
		if (isUnder(stripped, prefix)) return surface;
	}

	if (import.meta.env.DEV) {
		console.warn(
			`[platformSurfaces] "${pathname}" has no platform decision, so the installed app hides it. Add a rule to web/src/lib/platformSurfaces.ts.`,
		);
	}
	return null;
}

/** Whether the installed app shows this path. Always true in a browser. */
export function isVisibleInApp(path: string, isNative: boolean): boolean {
	if (!isNative) return true;
	return classifySurface(path) === "app";
}

/**
 * Where a hidden path sends the caller, or `null` when it is not hidden.
 *
 * Every destination is a static literal that classifies `app`, so it cannot
 * loop and cannot 404 — which matters because the callers include push taps
 * carrying paths written months ago.
 */
export function nativeDestinationFor(path: string): string | null {
	const surface = classifySurface(path);
	if (surface === "app") return null;
	if (surface === "silent") return NATIVE_HOME_PATH;
	// `staff` and anything unclassified share the generic wording — neither is
	// something the reader was promised, so neither needs a bespoke sentence.
	const reason =
		surface === "commerce" || surface === "marketplace"
			? surface
			: "unavailable";
	return `${NOT_AVAILABLE_PATH}?surface=${reason}`;
}

/** Drops nav entries the installed app does not show. Inert in a browser. */
export function filterNavByPlatform<T extends { to: string }>(
	items: readonly T[],
	isNative: boolean,
): T[] {
	if (!isNative) return [...items];
	return items.filter((item) => isVisibleInApp(item.to, isNative));
}
