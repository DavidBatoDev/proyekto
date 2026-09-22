import {
	Building2,
	Compass,
	FolderKanban,
	type LucideIcon,
	MessagesSquare,
	Route,
	ShieldCheck,
	Sparkles,
	Store,
	Timer,
	UserCircle,
} from "lucide-react";
import type { DocSectionId } from "@/content/docs.manifest";

/**
 * How each docs section looks.
 *
 * Kept out of `docs.manifest.ts` on purpose: that module is content metadata,
 * read by node-side tests and by the sitemap script, and it has no business
 * importing an icon library. This is the presentation layer keyed by the same
 * ids, and `docsSectionStyle.test.ts` asserts the two stay in step.
 *
 * The tints follow the one dark-mode-aware idiom in the codebase —
 * `CATEGORY_TONES` in `routes/roadmap-templates/index.tsx`. A 15% fill of a
 * saturated colour sits on any of the six theme grounds without being restated
 * per theme, and the foreground flips at `dark:` because a 700-weight text
 * colour that reads on white disappears on navy.
 *
 * Colour here is an *index*, not decoration: it is what makes a section
 * recognisable in the rail, on a card and in the article eyebrow without the
 * reader having to re-read the label each time.
 */
export interface DocSectionStyle {
	icon: LucideIcon;
	/** Applied to the icon chip: a tinted ground plus a readable foreground. */
	tone: string;
}

export const SECTION_STYLE: Record<DocSectionId, DocSectionStyle> = {
	"start-here": {
		icon: Compass,
		tone: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
	},
	"account-and-apps": {
		icon: UserCircle,
		tone: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
	},
	"workspaces-and-plans": {
		icon: Building2,
		tone: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
	},
	projects: {
		icon: FolderKanban,
		tone: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
	},
	"roadmaps-and-work": {
		icon: Route,
		tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
	},
	"ai-assistant": {
		icon: Sparkles,
		tone: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
	},
	"chat-and-meetings": {
		icon: MessagesSquare,
		tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
	},
	"delivery-governance": {
		icon: ShieldCheck,
		tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
	},
	"teams-time-and-rates": {
		icon: Timer,
		tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
	},
	"clients-and-marketplace": {
		icon: Store,
		tone: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
	},
};

export function sectionStyle(id: DocSectionId): DocSectionStyle {
	return SECTION_STYLE[id];
}
