// The header is global, so this is the one nav that spans both halves of the
// product: the marketplace shell and the execution workspace. Each entry is
// the top-level counterpart to a sidebar link — the marketplace sidebar's
// "Back to workspace" and the execution sidebar's marketplace entry —
// without which the only way across is from inside a sidebar, which the
// marketplace's own public pages do not render.
// Engagements sits between them because it is the bridge: who hired whom,
// connecting a marketplace agreement to the execution work it covers. Like
// Execution, it is shown to signed-out visitors too and simply asks them to
// log in. The order moves from the execution workspace back toward discovery.
export interface HeaderNavItem {
	label: string;
	to: string;
}

export const HEADER_NAV_ITEMS: HeaderNavItem[] = [
	{ label: "Execution", to: "/dashboard" },
	{ label: "Engagements", to: "/engagements" },
	{ label: "Marketplace", to: "/marketplace" },
];
