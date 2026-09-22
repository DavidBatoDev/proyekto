import { ILLUSTRATION_SVG_PROPS as SVG_PROPS } from "@/components/common/illustrationPrimitives";
import type { DocSectionId } from "@/content/docs.manifest";

/**
 * One small flat scene per docs section.
 *
 * Same grammar as every other illustration set in the app — see
 * `common/illustrationPrimitives.tsx`. Deliberately not library glyphs: a
 * `Compass` says "navigation", a `Store` says "shop"; these say what the
 * section actually contains — a roadmap branching off a spine, a week with one
 * slot taken, rows collapsing into a payout.
 *
 * Two constraints shaped every one of them. They render as small as 28px in
 * the sidebar rail, so each is built from a handful of bold shapes with no
 * detail that turns to mud; and they are drawn entirely in theme tokens
 * (`fill-primary`, `fill-muted-foreground`, `stroke-border`) with a shared
 * opacity ladder, so a section's tint is the only thing that distinguishes it
 * and every one of them inverts correctly across all six themes.
 *
 * `fill-current` is what ties them to their section: the wrapper sets the tint
 * as its text colour, so the accent shape inherits it rather than every scene
 * hard-coding a hue.
 */

interface Props {
	className?: string;
}

/** The muted ground every scene sits on. Rounder and lighter than `Sheet`. */
function Ground({ x = 5, y = 7, w = 38, h = 34 }) {
	return (
		<rect
			x={x}
			y={y}
			width={w}
			height={h}
			rx="5"
			className="fill-muted-foreground"
			opacity="0.1"
		/>
	);
}

/** A content line. The scenes' filler, never the subject. */
function Line({
	x,
	y,
	w,
	o = 0.35,
}: {
	x: number;
	y: number;
	w: number;
	o?: number;
}) {
	return (
		<rect
			x={x}
			y={y}
			width={w}
			height="3"
			rx="1.5"
			className="fill-muted-foreground"
			opacity={o}
		/>
	);
}

/** Start here — a marker planted on the first line of a page. */
function StartHere({ className }: Props) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Ground />
			<Line x={19} y={17} w={17} />
			<Line x={19} y={24} w={13} o={0.25} />
			<Line x={19} y={31} w={15} o={0.25} />
			<path
				d="M12 14v20"
				className="stroke-current"
				strokeWidth="2.6"
				strokeLinecap="round"
			/>
			<path d="M12 14h8l-2.4 4L20 22h-8z" className="fill-current" />
		</svg>
	);
}

/** Account & apps — a person, and the same account on a phone. */
function AccountApps({ className }: Props) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Ground />
			<circle cx="19" cy="19" r="5" className="fill-current" />
			<path
				d="M11 35c0-4.4 3.6-8 8-8s8 3.6 8 8"
				className="fill-current"
				opacity="0.35"
			/>
			<rect
				x="30"
				y="16"
				width="9"
				height="16"
				rx="2.5"
				className="fill-muted-foreground"
				opacity="0.3"
			/>
			<rect
				x="33"
				y="19"
				width="3"
				height="3"
				rx="1.5"
				className="fill-current"
			/>
		</svg>
	);
}

/** Workspaces & plans — tiers, with the one you are on lit. */
function WorkspacesPlans({ className }: Props) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Ground />
			<rect
				x="11"
				y="29"
				width="8"
				height="8"
				rx="2"
				className="fill-muted-foreground"
				opacity="0.3"
			/>
			<rect
				x="20"
				y="22"
				width="8"
				height="15"
				rx="2"
				className="fill-current"
			/>
			<rect
				x="29"
				y="26"
				width="8"
				height="11"
				rx="2"
				className="fill-muted-foreground"
				opacity="0.3"
			/>
			<Line x={11} y={13} w={14} />
		</svg>
	);
}

/** Projects — a container with its work inside. */
function Projects({ className }: Props) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Ground />
			<path
				d="M10 16h8l2.5 3H38a2 2 0 0 1 2 2v1H10z"
				className="fill-current"
				opacity="0.45"
			/>
			<rect
				x="10"
				y="22"
				width="30"
				height="14"
				rx="2.5"
				className="fill-muted-foreground"
				opacity="0.22"
			/>
			<rect
				x="14"
				y="26"
				width="10"
				height="3"
				rx="1.5"
				className="fill-current"
			/>
			<Line x={14} y={31} w={18} o={0.3} />
		</svg>
	);
}

/** Roadmaps & work — a spine with features branching off it. */
function RoadmapsWork({ className }: Props) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Ground />
			<rect
				x="10"
				y="14"
				width="7"
				height="6"
				rx="2"
				className="fill-current"
			/>
			<path
				d="M13.5 20v15M13.5 24h6M13.5 30h6M13.5 35h6"
				className="stroke-muted-foreground"
				strokeWidth="1.6"
				strokeLinecap="round"
				opacity="0.45"
			/>
			<rect
				x="20"
				y="21"
				width="17"
				height="5"
				rx="2"
				className="fill-current"
				opacity="0.5"
			/>
			<rect
				x="20"
				y="27"
				width="17"
				height="5"
				rx="2"
				className="fill-current"
				opacity="0.3"
			/>
			<rect
				x="20"
				y="33"
				width="12"
				height="5"
				rx="2"
				className="fill-current"
				opacity="0.18"
			/>
		</svg>
	);
}

/** AI assistant — a proposal answered, with the accent on what it drafted. */
function AiAssistant({ className }: Props) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Ground />
			<rect
				x="10"
				y="13"
				width="17"
				height="9"
				rx="3"
				className="fill-muted-foreground"
				opacity="0.28"
			/>
			<rect
				x="21"
				y="25"
				width="17"
				height="11"
				rx="3"
				className="fill-current"
			/>
			<path
				d="M25 30.5h9M25 33h6"
				className="stroke-background"
				strokeWidth="1.6"
				strokeLinecap="round"
				opacity="0.85"
			/>
			<path
				d="M14.5 28.5l1.1 2.6 2.6 1.1-2.6 1.1-1.1 2.6-1.1-2.6L10.8 32.2l2.6-1.1z"
				className="fill-current"
			/>
		</svg>
	);
}

/** Chat & meetings — a thread, and a slot taken in the week. */
function ChatMeetings({ className }: Props) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Ground />
			<path
				d="M10 14h16a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 26 26h-9l-4.5 4v-4h-2.5A2.5 2.5 0 0 1 7.5 23.5v-7A2.5 2.5 0 0 1 10 14z"
				className="fill-current"
				opacity="0.4"
			/>
			<rect
				x="24"
				y="22"
				width="16"
				height="15"
				rx="2.5"
				className="fill-muted-foreground"
				opacity="0.25"
			/>
			<path
				d="M24 27h16"
				className="stroke-background"
				strokeWidth="1.4"
				opacity="0.7"
			/>
			<rect
				x="27"
				y="29.5"
				width="5"
				height="5"
				rx="1.5"
				className="fill-current"
			/>
		</svg>
	);
}

/** Delivery governance — a record, signed off. */
function DeliveryGovernance({ className }: Props) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Ground />
			<rect
				x="12"
				y="12"
				width="20"
				height="26"
				rx="3"
				className="fill-muted-foreground"
				opacity="0.25"
			/>
			<Line x={16} y={18} w={12} />
			<Line x={16} y={24} w={9} o={0.25} />
			<circle cx="32" cy="32" r="8" className="fill-current" />
			<path
				d="M28.5 32l2.4 2.4 4.6-4.8"
				className="stroke-background"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				fill="none"
			/>
		</svg>
	);
}

/** Teams, time & rates — people, and the time they logged. */
function TeamsTimeRates({ className }: Props) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Ground />
			<circle
				cx="15"
				cy="18"
				r="4.5"
				className="fill-muted-foreground"
				opacity="0.35"
			/>
			<circle cx="24" cy="18" r="4.5" className="fill-current" opacity="0.55" />
			<path
				d="M8 33c0-3.9 3.1-7 7-7s7 3.1 7 7M17 33c0-3.9 3.1-7 7-7s7 3.1 7 7"
				className="fill-muted-foreground"
				opacity="0.22"
			/>
			<circle cx="34" cy="30" r="7.5" className="fill-current" />
			<path
				d="M34 26v4.4l2.8 1.8"
				className="stroke-background"
				strokeWidth="1.8"
				strokeLinecap="round"
				fill="none"
			/>
		</svg>
	);
}

/** Clients & the marketplace — a storefront. */
function ClientsMarketplace({ className }: Props) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Ground />
			<path d="M9 17h30l-2.5 6h-25z" className="fill-current" opacity="0.45" />
			<rect
				x="11.5"
				y="23"
				width="25"
				height="14"
				rx="2.5"
				className="fill-muted-foreground"
				opacity="0.25"
			/>
			<rect
				x="20"
				y="27"
				width="8"
				height="10"
				rx="1.5"
				className="fill-current"
			/>
		</svg>
	);
}

export const SECTION_ILLUSTRATION: Record<
	DocSectionId,
	(props: Props) => React.ReactElement
> = {
	"start-here": StartHere,
	"account-and-apps": AccountApps,
	"workspaces-and-plans": WorkspacesPlans,
	projects: Projects,
	"roadmaps-and-work": RoadmapsWork,
	"ai-assistant": AiAssistant,
	"chat-and-meetings": ChatMeetings,
	"delivery-governance": DeliveryGovernance,
	"teams-time-and-rates": TeamsTimeRates,
	"clients-and-marketplace": ClientsMarketplace,
};
