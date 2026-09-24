import {
	FileSignature,
	Handshake,
	type LucideIcon,
	ReceiptText,
	Share2,
	Users,
	Wallet,
} from "lucide-react";

/**
 * Navigation for the engagements shell at `/engagements`.
 *
 * ONE tree, and every page in the shell sits on exactly one node of it:
 *
 *   ENGAGEMENTS
 *     Overview          /engagements                       (+ /engagements/$id)
 *     Contracts         /engagements/contracts             (+ /contracts/$id)
 *   FINANCE
 *     My finance        /engagements/finance               consolidated, every team
 *     My teams          /engagements/finance/teams
 *       <team>          /engagements/finance/team/$teamId/…
 *         <project>     /engagements/finance/team/$teamId/project/$bookId
 *     Shared with me    /engagements/finance/shared
 *
 * `resolveEngagementsLocation` is the single reader of that tree: the sidebar
 * highlight, the breadcrumb trail, and search all derive from it, so the
 * three can never disagree about where the user is. Contracts live only on
 * the Engagements side; finance pages link to them but never list them.
 */
export interface EngagementsNavItem {
	key: EngagementsNavKey;
	to: string;
	label: string;
	icon: LucideIcon;
}

export type EngagementsNavKey =
	| "engagements"
	| "contracts"
	| "my-finance"
	| "my-teams"
	| "shared";

export const ENGAGEMENTS_NAV_ITEMS: EngagementsNavItem[] = [
	{
		key: "engagements",
		to: "/engagements",
		label: "Overview",
		icon: Handshake,
	},
	{
		key: "contracts",
		to: "/engagements/contracts",
		label: "Contracts",
		icon: FileSignature,
	},
];

/**
 * The static finance places. Teams and their project books hang under
 * "My teams" at render time, from the finance hub payload.
 */
export const FINANCE_NAV_ITEMS: EngagementsNavItem[] = [
	{
		key: "my-finance",
		to: "/engagements/finance",
		label: "My finance",
		icon: Wallet,
	},
	{
		key: "my-teams",
		to: "/engagements/finance/teams",
		label: "My teams",
		icon: Users,
	},
];

export const SHARED_NAV_ITEM: EngagementsNavItem = {
	key: "shared",
	to: "/engagements/finance/shared",
	label: "Shared with me",
	icon: Share2,
};

/** Where a pathname sits in the engagements tree. */
export interface EngagementsLocation {
	/** The static sidebar item that owns this page, if any. */
	nav: EngagementsNavKey | null;
	/** Set on every page inside one team's finance. */
	teamId?: string;
	/** Set on a project-finance page (the project's book). */
	bookId?: string;
	/** The team tab (`overview`, `invoices`, `time-logs`, …) when on a team page. */
	teamTab?: string;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TEAM_RE = new RegExp(
	`^/engagements/finance/team/(${UUID})(?:/project/(${UUID}))?(?:/([a-z-]+))?`,
	"i",
);

export function resolveEngagementsLocation(
	pathname: string,
): EngagementsLocation {
	const path = pathname.replace(/\/+$/, "") || "/";

	const team = TEAM_RE.exec(path);
	if (team) {
		const [, teamId, bookId, tab] = team;
		return {
			nav: "my-teams",
			teamId,
			bookId: bookId || undefined,
			teamTab: bookId ? undefined : (tab ?? "overview"),
		};
	}
	if (path.startsWith("/engagements/finance/teams")) return { nav: "my-teams" };
	if (path.startsWith("/engagements/finance/shared")) return { nav: "shared" };
	if (path.startsWith("/engagements/contracts")) return { nav: "contracts" };
	// Legacy contract editor URL (redirects, but may render for a frame).
	if (new RegExp(`^/engagements/finance/${UUID}$`, "i").test(path)) {
		return { nav: "contracts" };
	}
	if (path.startsWith("/engagements/finance")) {
		// Setup wizards, invites, the invoice builder, and imports documents are
		// all reached from My finance or a team; with no team in the URL they
		// belong to My finance.
		return { nav: "my-finance" };
	}
	if (path.startsWith("/engagements")) return { nav: "engagements" };
	return { nav: null };
}

/**
 * Destinations that are tabs rather than sidebar entries, for global search:
 * a user who searches "invoices" still means to land somewhere real.
 */
export const FINANCE_TAB_PAGES: {
	key: string;
	to: string;
	label: string;
	icon: LucideIcon;
}[] = [
	{
		key: "finance-invoices",
		to: "/engagements/finance/invoices",
		label: "Invoices",
		icon: ReceiptText,
	},
];
