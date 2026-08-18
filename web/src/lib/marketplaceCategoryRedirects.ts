/**
 * Where a retired category slug now lives.
 *
 * The taxonomy went from eleven top-level categories to seven by merging, and
 * the merged rows kept their sub-categories, slugs and memberships. The parent
 * URLs are the only thing that moved, so every retired one forwards rather than
 * 404s — the mega-menu, the browse grid and any link already shared all carry
 * these paths.
 *
 * Sub-category slugs did NOT change, so a leaf URL only needs its first segment
 * swapped: `/category/sales-and-revenue/sales-strategy` still resolves, under
 * `growth-and-sales`.
 *
 * `industry-practices` is deliberately absent. It was retired outright rather
 * than merged — it classified sectors, not disciplines — so there is no honest
 * destination for it, and forwarding it to an unrelated discipline would be
 * worse than the not-found page it now gets.
 */
export const RETIRED_CATEGORY_SLUGS: Readonly<Record<string, string>> = {
	"growth-and-marketing": "growth-and-sales",
	"sales-and-revenue": "growth-and-sales",
	"finance-and-fundraising": "business-operations",
	"operations-and-delivery": "business-operations",
	"people-and-organisation": "business-operations",
};

/**
 * The category slug a request should end up on, or `undefined` when it is
 * already current. Case-insensitive, because a slug typed by hand is still a
 * link worth honouring.
 */
export function mapRetiredCategorySlug(slug: string): string | undefined {
	return RETIRED_CATEGORY_SLUGS[slug.toLowerCase()];
}
