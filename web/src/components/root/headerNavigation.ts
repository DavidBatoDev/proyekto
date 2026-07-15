import { SECTION_IDS } from "@/contexts/PresentationContext";

export const HEADER_NAV_ITEMS = [
	{ label: "Use It Your Way", sectionIndex: 1 },
	{ label: "How It Works", sectionIndex: 2 },
	{ label: "Why Proyekto", sectionIndex: 4 },
	{
		label: "Templates",
		sectionIndex: 5,
		to: "/roadmap-templates" as const,
	},
	{ label: "Features", sectionIndex: 6 },
] as const;

export type HeaderNavItem = (typeof HEADER_NAV_ITEMS)[number];

export type HeaderNavAction =
	| { kind: "section"; sectionIndex: number }
	| { kind: "route"; to: "/" | "/roadmap-templates"; hash?: string };

export function resolveHeaderNavAction(
	item: HeaderNavItem,
	isLandingPage: boolean,
): HeaderNavAction {
	if ("to" in item) return { kind: "route", to: item.to };
	if (isLandingPage) {
		return { kind: "section", sectionIndex: item.sectionIndex };
	}
	return {
		kind: "route",
		to: "/",
		hash: SECTION_IDS[item.sectionIndex],
	};
}
