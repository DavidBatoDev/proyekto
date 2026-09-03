/**
 * Hand-built illustrations for the marketplace capability cards.
 *
 * Small flat scenes that say what the capability *is* — a plan being drawn,
 * work being accepted, a scope change being weighed. The shared grammar (the
 * sheet, the badge, why these are not library glyphs) lives in
 * `common/illustrationPrimitives.tsx`.
 */

import {
	Badge,
	Sheet,
	ILLUSTRATION_SVG_PROPS as SVG_PROPS,
} from "@/components/common/illustrationPrimitives";

interface CapabilityIconProps {
	className?: string;
}

/** A roadmap being drawn: a spine with work branching off it. */
export function RoadmapPreviewIcon({ className }: CapabilityIconProps) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Sheet />
			<rect
				x="10.5"
				y="14"
				width="5.5"
				height="5.5"
				rx="1.6"
				className="fill-primary"
			/>
			<path
				d="M13.25 19.5v14M13.25 24.5h4.5M13.25 31.5h4.5"
				className="stroke-muted-foreground"
				strokeWidth="1.4"
				strokeLinecap="round"
				opacity="0.5"
			/>
			<rect
				x="18"
				y="21.8"
				width="10"
				height="5.4"
				rx="1.6"
				className="fill-primary"
				opacity="0.3"
			/>
			<rect
				x="18"
				y="28.8"
				width="10"
				height="5.4"
				rx="1.6"
				className="fill-muted-foreground"
				opacity="0.22"
			/>
			<Badge>
				<path
					d="M32.6 15h5.6M36.4 13.2 38.4 15l-2 1.8"
					className="stroke-primary-foreground"
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</Badge>
		</svg>
	);
}

/** Work accepted: a checklist where the last item is signed off. */
export function DeliverableAcceptedIcon({ className }: CapabilityIconProps) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Sheet />
			<rect
				x="11"
				y="16"
				width="4"
				height="4"
				rx="1.2"
				className="fill-muted-foreground"
				opacity="0.3"
			/>
			<rect
				x="17"
				y="17"
				width="12"
				height="2"
				rx="1"
				className="fill-muted-foreground"
				opacity="0.35"
			/>
			<rect
				x="11"
				y="23"
				width="4"
				height="4"
				rx="1.2"
				className="fill-muted-foreground"
				opacity="0.3"
			/>
			<rect
				x="17"
				y="24"
				width="10"
				height="2"
				rx="1"
				className="fill-muted-foreground"
				opacity="0.35"
			/>
			<rect
				x="11"
				y="30"
				width="4"
				height="4"
				rx="1.2"
				className="fill-primary"
			/>
			<rect
				x="17"
				y="31"
				width="12"
				height="2"
				rx="1"
				className="fill-primary"
				opacity="0.45"
			/>
			<Badge>
				<path
					d="M32.5 15.2l2.4 2.4 4.6-4.8"
					className="stroke-primary-foreground"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</Badge>
		</svg>
	);
}

/** A scope change: two sheets, the second carrying the delta. */
export function ChangeRequestIcon({ className }: CapabilityIconProps) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<rect
				x="6"
				y="12"
				width="24"
				height="28"
				rx="3"
				className="fill-muted"
				opacity="0.6"
			/>
			<Sheet x={12} y={8} w={22} h={32} />
			<rect
				x="17"
				y="16"
				width="12"
				height="2"
				rx="1"
				className="fill-muted-foreground"
				opacity="0.35"
			/>
			<rect
				x="17"
				y="21"
				width="9"
				height="2"
				rx="1"
				className="fill-muted-foreground"
				opacity="0.35"
			/>
			<rect
				x="17"
				y="28"
				width="12"
				height="6"
				rx="2"
				className="fill-primary"
				opacity="0.25"
			/>
			<rect
				x="17"
				y="28"
				width="4"
				height="6"
				rx="2"
				className="fill-primary"
			/>
			<Badge cx={36} cy={16}>
				<path
					d="M32.6 14.2h6M36.6 12.7l1.9 1.5-1.9 1.5M39.4 18.2h-6M35.4 16.7l-1.9 1.5 1.9 1.5"
					className="stroke-primary-foreground"
					strokeWidth="1.4"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</Badge>
		</svg>
	);
}

/** A signed agreement: terms above, a signature stroke below. */
export function SignedContractIcon({ className }: CapabilityIconProps) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Sheet />
			<rect
				x="11"
				y="15"
				width="16"
				height="2"
				rx="1"
				className="fill-muted-foreground"
				opacity="0.35"
			/>
			<rect
				x="11"
				y="20"
				width="12"
				height="2"
				rx="1"
				className="fill-muted-foreground"
				opacity="0.35"
			/>
			<rect
				x="11"
				y="25"
				width="15"
				height="2"
				rx="1"
				className="fill-muted-foreground"
				opacity="0.35"
			/>
			<path
				d="M11 34c2.2-3.4 4-3.4 5.2-1.2 1 1.9 2.3 1.9 3.4.2 1.1-1.7 2.6-1.6 4.4.8"
				className="stroke-primary"
				strokeWidth="1.8"
				strokeLinecap="round"
				fill="none"
			/>
			<Badge>
				<path
					d="M32.6 18.4l.7-2.4 4.6-4.6 1.7 1.7-4.6 4.6-2.4.7z"
					className="fill-primary-foreground"
				/>
			</Badge>
		</svg>
	);
}

/** Two parties, durably linked: the engagement record. */
export function EngagementRecordIcon({ className }: CapabilityIconProps) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<rect x="4" y="17" width="16" height="21" rx="3" className="fill-muted" />
			<rect
				x="4"
				y="17"
				width="16"
				height="21"
				rx="3"
				className="stroke-border"
				strokeWidth="1"
			/>
			<rect
				x="24"
				y="17"
				width="16"
				height="21"
				rx="3"
				className="fill-muted"
			/>
			<rect
				x="24"
				y="17"
				width="16"
				height="21"
				rx="3"
				className="stroke-border"
				strokeWidth="1"
			/>
			<circle cx="12" cy="25" r="3.4" className="fill-primary" />
			<rect
				x="7.5"
				y="31"
				width="9"
				height="2"
				rx="1"
				className="fill-muted-foreground"
				opacity="0.32"
			/>
			<circle cx="32" cy="25" r="3.4" className="fill-primary" opacity="0.35" />
			<rect
				x="27.5"
				y="31"
				width="9"
				height="2"
				rx="1"
				className="fill-muted-foreground"
				opacity="0.32"
			/>
			<path
				d="M20 27.5h4"
				className="stroke-primary"
				strokeWidth="2"
				strokeLinecap="round"
			/>
			<Badge cx={36} cy={13}>
				<path
					d="M34.2 13a1.9 1.9 0 0 1 1.9-1.9h.6M37.8 13a1.9 1.9 0 0 1-1.9 1.9h-.6M34.6 13h2.8"
					className="stroke-primary-foreground"
					strokeWidth="1.4"
					strokeLinecap="round"
				/>
			</Badge>
		</svg>
	);
}

/**
 * Larger empty-state art for the "pick up where you left off" panel.
 *
 * Same grammar as the capability icons — muted sheets, one primary tile — but
 * drawn at 96px where a little more detail survives. Three stacked sheets read
 * as "nothing here yet, but this is the shape of what goes here".
 */
export function EmptyWorkspaceArt({ className }: CapabilityIconProps) {
	return (
		<svg
			viewBox="0 0 96 96"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden
			focusable="false"
			className={className}
		>
			<rect
				x="8"
				y="26"
				width="30"
				height="44"
				rx="4"
				className="fill-muted"
				opacity="0.55"
			/>
			<rect
				x="58"
				y="26"
				width="30"
				height="44"
				rx="4"
				className="fill-muted"
				opacity="0.55"
			/>
			<rect
				x="28"
				y="16"
				width="40"
				height="60"
				rx="5"
				className="fill-background"
			/>
			<rect
				x="28"
				y="16"
				width="40"
				height="60"
				rx="5"
				className="stroke-border"
				strokeWidth="1.5"
			/>
			<rect
				x="35"
				y="25"
				width="26"
				height="3"
				rx="1.5"
				className="fill-muted-foreground"
				opacity="0.3"
			/>
			<rect
				x="35"
				y="32"
				width="19"
				height="3"
				rx="1.5"
				className="fill-muted-foreground"
				opacity="0.3"
			/>
			<rect
				x="35"
				y="44"
				width="26"
				height="24"
				rx="4"
				className="fill-primary"
			/>
			<path
				d="M48 50.5l1.9 4.6 4.6 1.9-4.6 1.9-1.9 4.6-1.9-4.6-4.6-1.9 4.6-1.9z"
				className="fill-primary-foreground"
			/>
		</svg>
	);
}
