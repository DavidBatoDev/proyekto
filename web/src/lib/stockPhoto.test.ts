import { describe, expect, it, vi } from "vitest";

// A stand-in manifest: the real one is generated and empty until the first
// seed run, so the tests would otherwise assert nothing.
vi.mock("@/data/stockPhotoManifest", () => ({
	STOCK_PHOTO_BASE_URL: "https://cdn.proyekto.tech",
	STOCK_PHOTO_MANIFEST: {
		"web-development": ["stock/web-development/01.jpg"],
		"mobile-app": ["stock/mobile-app/01.jpg", "stock/mobile-app/02.jpg"],
		saas: ["stock/saas/01.jpg"],
		"ai-ml": ["stock/ai-ml/01.jpg"],
		"e-commerce": ["stock/e-commerce/01.jpg"],
		marketing: ["stock/marketing/01.jpg"],
		"health-fitness": ["stock/health-fitness/01.jpg"],
		finance: ["stock/finance/01.jpg"],
		education: ["stock/education/01.jpg"],
		design: ["stock/design/01.jpg"],
		"data-analytics": ["stock/data-analytics/01.jpg"],
		"devops-cloud": ["stock/devops-cloud/01.jpg"],
		security: ["stock/security/01.jpg"],
		operations: ["stock/operations/01.jpg"],
		"team-collaboration": ["stock/team-collaboration/01.jpg"],
		generic: [
			"stock/generic/01.jpg",
			"stock/generic/02.jpg",
			"stock/generic/03.jpg",
			"stock/generic/04.jpg",
		],
	},
}));

const { pickStockPhotoUrl, resolveStockTheme, stockPhotoPoolSize } =
	await import("./stockPhoto");

describe("resolveStockTheme", () => {
	it.each([
		["Web Development", "web-development"],
		["Mobile App", "mobile-app"],
		["SaaS", "saas"],
		["AI / ML", "ai-ml"],
		["E-commerce", "e-commerce"],
		["Marketing", "marketing"],
		["Health & Fitness", "health-fitness"],
	])("maps the create-flow category %s", (category, expected) => {
		expect(resolveStockTheme(category)).toBe(expected);
	});

	it("maps categories the AI can invent onto a sensible theme", () => {
		expect(resolveStockTheme("Fintech Compliance")).toBe("finance");
		expect(resolveStockTheme("Cybersecurity Audit")).toBe("security");
		expect(resolveStockTheme("Supply Chain Logistics")).toBe("operations");
		expect(resolveStockTheme("Online Course Platform")).toBe("education");
	});

	it("falls back to generic for a category that matches nothing", () => {
		expect(resolveStockTheme("Pet Grooming")).toBe("generic");
		expect(resolveStockTheme("Zzzz Qqqq")).toBe("generic");
	});

	it("falls back to generic for empty or whitespace input", () => {
		expect(resolveStockTheme("")).toBe("generic");
		expect(resolveStockTheme("   ")).toBe("generic");
		expect(resolveStockTheme(",,,")).toBe("generic");
	});

	it("weights the first category above the later ones", () => {
		expect(resolveStockTheme("Finance & Billing, Mobile App")).toBe("finance");
	});

	it("still scores the later categories rather than discarding them", () => {
		// "Business Management" matches nothing, so the specific signal lives in
		// the trailing part — dropping it would land on generic.
		expect(resolveStockTheme("Business Management, Cybersecurity")).toBe(
			"security",
		);
	});

	it("lets a later category break a tie the first cannot", () => {
		expect(resolveStockTheme("Other, Warehouse Logistics")).toBe("operations");
	});

	it("weights the category above the title", () => {
		// "mobile" in the title must not beat "finance" in the category.
		expect(resolveStockTheme("Finance", "Mobile companion")).toBe("finance");
	});

	it("uses the title when the category is uninformative", () => {
		expect(resolveStockTheme("Other", "Kubernetes cluster migration")).toBe(
			"devops-cloud",
		);
	});

	it("expands acronyms before matching", () => {
		expect(resolveStockTheme("AI")).toBe("ai-ml");
		expect(resolveStockTheme("HR")).toBe("team-collaboration");
	});

	it("normalizes punctuation and casing", () => {
		expect(resolveStockTheme("  HEALTH & fitness  ")).toBe(
			resolveStockTheme("health fitness"),
		);
	});
});

describe("pickStockPhotoUrl", () => {
	it("returns an absolute CDN url", () => {
		expect(pickStockPhotoUrl("web-development", "Any Roadmap")).toBe(
			"https://cdn.proyekto.tech/stock/web-development/01.jpg",
		);
	});

	it("is stable for a given seed", () => {
		expect(pickStockPhotoUrl("generic", "Mobile Product Launch")).toBe(
			pickStockPhotoUrl("generic", "Mobile Product Launch"),
		);
	});

	it("varies across seeds", () => {
		const urls = new Set(
			["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].map((seed) =>
				pickStockPhotoUrl("generic", seed),
			),
		);
		expect(urls.size).toBeGreaterThan(1);
	});

	it("advances and wraps with the shuffle offset", () => {
		const seed = "Some Roadmap";
		const first = pickStockPhotoUrl("generic", seed, 0);
		const second = pickStockPhotoUrl("generic", seed, 1);
		expect(second).not.toBe(first);
		// The generic pool holds 4 photos, so offset 4 lands back on offset 0.
		expect(pickStockPhotoUrl("generic", seed, 4)).toBe(first);
	});

	it("returns null for an empty pool so the caller falls back to the gradient", () => {
		expect(pickStockPhotoUrl("does-not-exist", "seed")).toBeNull();
	});

	it("returns the single photo regardless of offset for a one-item pool", () => {
		expect(pickStockPhotoUrl("saas", "seed", 7)).toBe(
			"https://cdn.proyekto.tech/stock/saas/01.jpg",
		);
	});
});

describe("stockPhotoPoolSize", () => {
	it("reports the pool size", () => {
		expect(stockPhotoPoolSize("generic")).toBe(4);
		expect(stockPhotoPoolSize("mobile-app")).toBe(2);
		expect(stockPhotoPoolSize("saas")).toBe(1);
	});

	it("reports zero for an unknown theme", () => {
		expect(stockPhotoPoolSize("does-not-exist")).toBe(0);
	});
});
