/**
 * Curated stock photo selection for roadmap thumbnails.
 *
 * Entirely local: the photos are pre-seeded into R2 by
 * `scripts/seed_stock_photos.mjs` and addressed through a committed manifest,
 * so picking a cover image costs no network call, no API quota and no latency
 * on the roadmap create path. This replaced a Pexels-at-runtime integration
 * whose upstream call volume scaled 1:1 with roadmap creates.
 */

import {
	STOCK_PHOTO_BASE_URL,
	STOCK_PHOTO_MANIFEST,
} from "@/data/stockPhotoManifest";

export type StockTheme = string;

/** Pool used when a category matches no theme. Always present in the manifest. */
const FALLBACK_THEME = "generic";

/**
 * Keywords that map a category (or title) onto a theme.
 *
 * Matching is by score; a tie resolves to the theme declared first, so keep
 * genuinely ambiguous words ("platform", "software", "business") out of the
 * lists entirely rather than repeating them across themes — a duplicated word
 * makes the winner an accident of declaration order.
 *
 * The category strings reaching this function are NOT a closed set: the AI
 * metadata generator is only told to return "a plain product category under 80
 * characters", so it can invent anything. Hence fuzzy scoring plus a guaranteed
 * fallback rather than a lookup table.
 */
const THEME_KEYWORDS: Record<string, readonly string[]> = {
	"web-development": [
		"web",
		"website",
		"frontend",
		"backend",
		"fullstack",
		"development",
		"developer",
		"software",
		"engineering",
		"api",
	],
	"mobile-app": [
		"mobile",
		"app",
		"ios",
		"android",
		"phone",
		"tablet",
		"native",
		"flutter",
		"capacitor",
	],
	saas: [
		"saas",
		"subscription",
		"b2b",
		"startup",
		"product",
		"launch",
		"mvp",
		"venture",
	],
	"ai-ml": [
		"ai",
		"artificial",
		"intelligence",
		"ml",
		"machine",
		"learning",
		"neural",
		"llm",
		"chatbot",
		"robotics",
	],
	"e-commerce": [
		"ecommerce",
		"commerce",
		"shop",
		"shopify",
		"store",
		"storefront",
		"retail",
		"marketplace",
		"checkout",
		"cart",
	],
	marketing: [
		"marketing",
		"growth",
		"campaign",
		"brand",
		"branding",
		"seo",
		"advertising",
		"social",
		"content",
		"outreach",
	],
	"health-fitness": [
		"health",
		"fitness",
		"wellness",
		"medical",
		"healthcare",
		"clinic",
		"nutrition",
		"gym",
		"training",
		"mental",
		"care",
	],
	finance: [
		"finance",
		"financial",
		"fintech",
		"billing",
		"invoice",
		"invoicing",
		"payment",
		"payments",
		"accounting",
		"banking",
		"crypto",
		"payroll",
		"budget",
		"revenue",
	],
	education: [
		"education",
		"learning",
		"course",
		"school",
		"student",
		"teaching",
		"academy",
		"curriculum",
		"tutoring",
	],
	design: [
		"design",
		"ux",
		"ui",
		"user",
		"experience",
		"interface",
		"creative",
		"prototype",
		"figma",
		"visual",
	],
	"data-analytics": [
		"data",
		"analytics",
		"dashboard",
		"reporting",
		"metrics",
		"insights",
		"warehouse",
		"pipeline",
		"intelligence",
	],
	"devops-cloud": [
		"devops",
		"cloud",
		"infrastructure",
		"kubernetes",
		"docker",
		"deployment",
		"server",
		"hosting",
		"migration",
		"platform",
		"observability",
	],
	security: [
		"security",
		"cybersecurity",
		"compliance",
		"privacy",
		"audit",
		"encryption",
		"authentication",
		"identity",
		"governance",
		"risk",
	],
	operations: [
		"operations",
		"logistics",
		"supply",
		"chain",
		"inventory",
		"warehouse",
		"manufacturing",
		"fulfillment",
		"procurement",
		"workflow",
	],
	"team-collaboration": [
		"team",
		"collaboration",
		"collaborative",
		"hr",
		"human",
		"resources",
		"hiring",
		"recruitment",
		"onboarding",
		"culture",
		"remote",
		"communication",
		"tools",
	],
};

/**
 * Acronyms and shorthand expanded before matching, so a two-letter category
 * still reaches the right theme.
 */
const TOKEN_ALIASES: Record<string, string> = {
	ai: "artificial intelligence",
	ml: "machine learning",
	ux: "user experience design",
	ui: "interface design",
	crm: "customer relationship",
	hr: "human resources",
	iot: "connected devices",
	ar: "augmented reality",
	vr: "virtual reality",
	app: "mobile app",
	web: "web development",
	sec: "security",
	ops: "operations",
	bi: "business intelligence",
};

/** Lowercase, strip punctuation and separators, collapse whitespace. */
function tokenize(value: string): string[] {
	return (value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
}

/**
 * Expands acronyms and de-duplicates.
 *
 * The dedupe is load-bearing, not tidiness: "Mobile App" expands `app` to
 * "mobile app", which would otherwise score `mobile` twice and let a secondary
 * category out-weigh a stronger primary one. One source word should contribute
 * one hit.
 */
function expandAliases(tokens: string[]): string[] {
	return [
		...new Set(
			tokens.flatMap((token) =>
				TOKEN_ALIASES[token] ? TOKEN_ALIASES[token].split(" ") : [token],
			),
		),
	];
}

/** Stable non-negative 32-bit string hash (djb2), mirroring roadmapThumbnail. */
function hashString(input: string): number {
	let hash = 5381;
	for (let i = 0; i < input.length; i++) {
		hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
	}
	return Math.abs(hash);
}

/** Token weights, strongest signal first. */
const PRIMARY_CATEGORY_WEIGHT = 3;
const SECONDARY_CATEGORY_WEIGHT = 2;
const TITLE_WEIGHT = 1;

/**
 * Picks the best-matching theme for a roadmap.
 *
 * Categories arrive comma-joined ("Collaboration Tools, Business Management,
 * SaaS Platforms") and every part is scored: the user picked all of them, and
 * the later ones often carry the most specific signal. The first is weighted
 * highest, then the rest, then the title — titles are the noisiest input
 * ("v1", "revamp", a person's name).
 *
 * Never throws and never returns undefined; an unmatched category yields
 * `generic`.
 */
export function resolveStockTheme(category: string, title = ""): StockTheme {
	const categoryParts = (category ?? "")
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);

	const primaryTokens = expandAliases(tokenize(categoryParts[0] ?? ""));
	const secondaryTokens = expandAliases(
		tokenize(categoryParts.slice(1).join(" ")),
	);
	const titleTokens = expandAliases(tokenize(title));

	let bestTheme = FALLBACK_THEME;
	let bestScore = 0;

	for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
		const keywordSet = new Set(keywords);
		let score = 0;
		for (const token of primaryTokens) {
			if (keywordSet.has(token)) score += PRIMARY_CATEGORY_WEIGHT;
		}
		for (const token of secondaryTokens) {
			if (keywordSet.has(token)) score += SECONDARY_CATEGORY_WEIGHT;
		}
		for (const token of titleTokens) {
			if (keywordSet.has(token)) score += TITLE_WEIGHT;
		}

		if (score > bestScore) {
			bestScore = score;
			bestTheme = theme;
		}
	}

	// Only fall back when the theme has no photos at all — an unseeded pool
	// should degrade to `generic` rather than to no image.
	if (bestScore > 0 && (STOCK_PHOTO_MANIFEST[bestTheme]?.length ?? 0) > 0) {
		return bestTheme;
	}
	return FALLBACK_THEME;
}

/**
 * Resolves a stable photo URL for a roadmap.
 *
 * Deterministic in `seed` so a draft keeps the same cover across re-renders,
 * and so two roadmaps in one category rarely collide. `offset` is what the
 * Shuffle button increments; it wraps around the pool.
 *
 * Returns null when the pool is empty — the caller's signal to fall back to the
 * generated gradient thumbnail. That is the state before the first seed run.
 */
export function pickStockPhotoUrl(
	theme: StockTheme,
	seed: string,
	offset = 0,
): string | null {
	const pool = STOCK_PHOTO_MANIFEST[theme] ?? [];
	if (pool.length === 0) return null;

	const index = (hashString(seed) + offset) % pool.length;
	return `${STOCK_PHOTO_BASE_URL}/${pool[index]}`;
}

/** How many photos the theme offers — Shuffle is pointless below 2. */
export function stockPhotoPoolSize(theme: StockTheme): number {
	return STOCK_PHOTO_MANIFEST[theme]?.length ?? 0;
}
