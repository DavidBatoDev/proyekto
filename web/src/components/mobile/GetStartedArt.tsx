/**
 * Illustrations for the mobile Get Started deck.
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

/** Shared soft blob behind every scene — the reference decks all use one. */
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

/** Slide 1 — describe a goal, the AI drafts the plan. */
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

/** Slide 2 — a vetted consultant takes the plan on. */
export function ConsultantArt() {
	return (
		<svg
			className={wrap}
			viewBox="0 0 260 208"
			fill="none"
			role="img"
			aria-label="A verified consultant matched to a project"
		>
			<Backdrop />

			{/* profile card */}
			<rect
				x="62"
				y="44"
				width="136"
				height="120"
				rx="14"
				fill="var(--background)"
				stroke="var(--border)"
				strokeWidth="2"
			/>

			{/* avatar */}
			<circle cx="130" cy="82" r="22" fill="var(--primary)" opacity="0.18" />
			<circle cx="130" cy="74" r="9" fill="var(--primary)" />
			<path
				d="M114 96 C 116 84, 144 84, 146 96 Z"
				fill="var(--primary)"
				opacity="0.8"
			/>

			{/* verified tick */}
			<circle cx="150" cy="94" r="11" fill="var(--background)" />
			<circle cx="150" cy="94" r="9" fill="var(--primary)" />
			<path
				d="M145.5 94 l3.2 3.4 6-6.6"
				stroke="var(--primary-foreground)"
				strokeWidth="2.2"
				strokeLinecap="round"
				strokeLinejoin="round"
				fill="none"
			/>

			{/* name + title */}
			<rect
				x="98"
				y="118"
				width="64"
				height="7"
				rx="3.5"
				fill="var(--muted-foreground)"
				opacity="0.5"
			/>
			<rect
				x="110"
				y="133"
				width="40"
				height="6"
				rx="3"
				fill="var(--muted-foreground)"
				opacity="0.28"
			/>

			{/* rating */}
			{[0, 1, 2, 3, 4].map((i) => (
				<circle
					key={i}
					cx={106 + i * 12}
					cy={151}
					r="3.5"
					fill="var(--primary)"
					opacity={i === 4 ? 0.3 : 1}
				/>
			))}

			<rect
				x="34"
				y="178"
				width="192"
				height="4"
				rx="2"
				fill="var(--muted-foreground)"
				opacity="0.18"
			/>
		</svg>
	);
}

/** Slide 3 — the team executes and the work visibly moves. */
export function ExecuteArt() {
	return (
		<svg
			className={wrap}
			viewBox="0 0 260 208"
			fill="none"
			role="img"
			aria-label="Tasks moving across a board as a team delivers"
		>
			<Backdrop />

			{/* three columns of a board */}
			{[
				{ x: 34, done: 3 },
				{ x: 106, done: 2 },
				{ x: 178, done: 1 },
			].map((col) => (
				<g key={col.x}>
					<rect
						x={col.x}
						y="44"
						width="48"
						height="118"
						rx="10"
						fill="var(--background)"
						stroke="var(--border)"
						strokeWidth="2"
					/>
					{[0, 1, 2].map((row) => (
						<rect
							key={row}
							x={col.x + 8}
							y={56 + row * 34}
							width="32"
							height="24"
							rx="6"
							fill="var(--primary)"
							opacity={row < col.done ? 0.85 : 0.16}
						/>
					))}
				</g>
			))}

			{/* completion tick on the finished column */}
			<circle cx="58" cy="30" r="12" fill="var(--primary)" />
			<path
				d="M52.5 30 l4 4.2 7.4 -8"
				stroke="var(--primary-foreground)"
				strokeWidth="2.4"
				strokeLinecap="round"
				strokeLinejoin="round"
				fill="none"
			/>

			{/* the work moving right */}
			<path
				d="M92 100 H 100 M170 100 H 178"
				stroke="var(--primary)"
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeDasharray="4 5"
			/>

			<rect
				x="34"
				y="178"
				width="192"
				height="4"
				rx="2"
				fill="var(--muted-foreground)"
				opacity="0.18"
			/>
		</svg>
	);
}
