/**
 * Illustration for the mobile Get Started screen.
 *
 * Inline SVG rather than exported PNGs, for three reasons that matter here:
 * they are a few KB inside the JS bundle instead of a network round trip on a
 * cold first launch; they are painted from theme tokens so light and dark both
 * work without a second set of files; and they ship over OTA like any other
 * code, where a new image asset would need a native rebuild to be bundled.
 *
 * `--primary` carries the brand blue and `--muted-foreground` the neutral line
 * work, so these track the palette rather than pinning hexes.
 */

const wrap = "h-full w-full";

/** Soft blob behind the scene, as the reference decks all use. */
function Backdrop() {
	return (
		<>
			<ellipse
				cx="130"
				cy="104"
				rx="118"
				ry="92"
				fill="var(--primary)"
				opacity="0.07"
			/>
			<circle cx="30" cy="42" r="5" fill="var(--primary)" opacity="0.25" />
			<circle cx="236" cy="60" r="7" fill="var(--primary)" opacity="0.18" />
			<circle cx="222" cy="168" r="4" fill="var(--primary)" opacity="0.3" />
		</>
	);
}

/** Describe a goal, the AI drafts the plan. */
export function PlanArt() {
	return (
		<svg
			className={wrap}
			viewBox="0 0 260 208"
			fill="none"
			role="img"
			aria-label="A roadmap being drafted from a written goal"
		>
			<Backdrop />

			{/* the prompt the user types */}
			<rect
				x="34"
				y="46"
				width="106"
				height="52"
				rx="10"
				fill="var(--background)"
				stroke="var(--border)"
				strokeWidth="2"
			/>
			<rect
				x="46"
				y="60"
				width="66"
				height="6"
				rx="3"
				fill="var(--muted-foreground)"
				opacity="0.45"
			/>
			<rect
				x="46"
				y="74"
				width="44"
				height="6"
				rx="3"
				fill="var(--muted-foreground)"
				opacity="0.28"
			/>

			{/* the arc from prompt to plan */}
			<path
				d="M146 74 C 166 74, 168 96, 182 100"
				stroke="var(--primary)"
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeDasharray="5 6"
			/>

			{/* the generated roadmap: one epic, two children */}
			<rect
				x="180"
				y="58"
				width="56"
				height="20"
				rx="6"
				fill="var(--primary)"
			/>
			<rect
				x="180"
				y="92"
				width="56"
				height="18"
				rx="6"
				fill="var(--primary)"
				opacity="0.5"
			/>
			<rect
				x="180"
				y="124"
				width="56"
				height="18"
				rx="6"
				fill="var(--primary)"
				opacity="0.28"
			/>
			<path
				d="M172 68 L172 133 M172 101 H180 M172 68 H180 M172 133 H180"
				stroke="var(--primary)"
				strokeWidth="2"
				strokeLinecap="round"
				opacity="0.55"
			/>

			{/* sparkle: this part was written for you */}
			<path
				d="M126 34 l3.4 8.2 8.2 3.4 -8.2 3.4 -3.4 8.2 -3.4 -8.2 -8.2 -3.4 8.2 -3.4z"
				fill="var(--primary)"
			/>

			{/* the desk line */}
			<rect
				x="34"
				y="160"
				width="192"
				height="4"
				rx="2"
				fill="var(--muted-foreground)"
				opacity="0.18"
			/>
		</svg>
	);
}
