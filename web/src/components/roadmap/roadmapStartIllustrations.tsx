/**
 * Illustrations for the three ways to start a roadmap.
 *
 * Same grammar as every other illustration set — see
 * `common/illustrationPrimitives.tsx`, which owns the sheet and the badge.
 *
 * Deliberately not library glyphs. A `Sparkles` from the icon set says
 * "magic"; this says "a roadmap being drafted for you".
 */

import {
	Badge,
	Sheet,
	ILLUSTRATION_SVG_PROPS as SVG_PROPS,
} from "@/components/common/illustrationPrimitives";

interface RoadmapStartIllustrationProps {
	className?: string;
}

/**
 * Drafted for you: a full roadmap already branching off its spine, with the
 * sparkle badge. The one illustration where the sheet is busy — that is the
 * offer.
 */
export function AiRoadmapIllustration({
	className,
}: RoadmapStartIllustrationProps) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Sheet />
			<rect
				x="10.5"
				y="13"
				width="6"
				height="5.5"
				rx="1.6"
				className="fill-primary"
			/>
			<path
				d="M13.5 18.5v15M13.5 23.5h4.5M13.5 29h4.5M13.5 34.5h4.5"
				className="stroke-muted-foreground"
				strokeWidth="1.4"
				strokeLinecap="round"
				opacity="0.5"
			/>
			<rect
				x="18"
				y="20.8"
				width="11"
				height="5.4"
				rx="1.6"
				className="fill-primary"
				opacity="0.35"
			/>
			<rect
				x="18"
				y="26.3"
				width="11"
				height="5.4"
				rx="1.6"
				className="fill-primary"
				opacity="0.22"
			/>
			<rect
				x="18"
				y="31.8"
				width="11"
				height="5.4"
				rx="1.6"
				className="fill-muted-foreground"
				opacity="0.22"
			/>
			<Badge>
				<path
					d="M36 10.8c0.5 2.6 1.6 3.7 4.2 4.2-2.6 0.5-3.7 1.6-4.2 4.2-0.5-2.6-1.6-3.7-4.2-4.2 2.6-0.5 3.7-1.6 4.2-4.2Z"
					className="fill-primary-foreground"
				/>
			</Badge>
		</svg>
	);
}

/**
 * Yours to fill: the same sheet, empty except for the first node and the
 * dashed outline of where the next one goes.
 */
export function BlankRoadmapIllustration({
	className,
}: RoadmapStartIllustrationProps) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Sheet />
			<rect
				x="10.5"
				y="13"
				width="6"
				height="5.5"
				rx="1.6"
				className="fill-primary"
			/>
			<path
				d="M13.5 18.5v7M13.5 25.5h4.5"
				className="stroke-muted-foreground"
				strokeWidth="1.4"
				strokeLinecap="round"
				opacity="0.5"
			/>
			<rect
				x="18"
				y="22.8"
				width="11"
				height="5.4"
				rx="1.6"
				className="stroke-muted-foreground"
				strokeWidth="1.2"
				strokeDasharray="2.4 2.4"
				opacity="0.55"
			/>
			<Badge>
				<path
					d="M36 11.6v6.8M32.6 15h6.8"
					className="stroke-primary-foreground"
					strokeWidth="1.8"
					strokeLinecap="round"
				/>
			</Badge>
		</svg>
	);
}

/**
 * Someone else's, already finished: a stack of sheets with the starred one on
 * top.
 */
export function TemplateRoadmapIllustration({
	className,
}: RoadmapStartIllustrationProps) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<rect
				x="11"
				y="6"
				width="24"
				height="30"
				rx="3"
				className="fill-muted-foreground"
				opacity="0.18"
			/>
			<Sheet x={6} y={10} w={28} h={30} />
			<rect
				x="10.5"
				y="15"
				width="12"
				height="5"
				rx="1.6"
				className="fill-primary"
			/>
			<path
				d="M10.5 25h19M10.5 30h19M10.5 35h12"
				className="stroke-muted-foreground"
				strokeWidth="1.6"
				strokeLinecap="round"
				opacity="0.4"
			/>
			<Badge>
				<path
					d="M36 10.4 37.12 13.46 40.38 13.58 37.81 15.59 38.7 18.72 36 16.9 33.3 18.72 34.19 15.59 31.62 13.58 34.88 13.46Z"
					className="fill-primary-foreground"
				/>
			</Badge>
		</svg>
	);
}
