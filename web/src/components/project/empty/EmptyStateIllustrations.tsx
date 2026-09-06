/**
 * The four project empty-state illustrations.
 *
 * These are the *destination* — what the page looks like once it has data —
 * drawn flat and abstract, while the Remotion clip beside them shows how it
 * gets there. Splitting the two jobs is the point: a still can hold a shape
 * long enough to be read, and a video can show a change a still cannot.
 *
 * THEME TOKENS ONLY, no raw hex. These render inside the app shell, which
 * follows the user's theme, so every fill and stroke is a Tailwind token class
 * (`fill-primary`, `stroke-border`, `fill-muted-foreground/25`) resolving
 * through the `@theme` block in styles.css. A baked hex would go wrong in
 * exactly one of the two themes — the same trade the Remotion clips accept and
 * these do not have to.
 *
 * `aria-hidden` throughout: each one sits next to a heading and a description
 * that already say what it shows, so announcing it again is noise.
 */

const SVG_PROPS = {
	viewBox: "0 0 320 200",
	fill: "none",
	xmlns: "http://www.w3.org/2000/svg",
	"aria-hidden": true as const,
	className: "h-auto w-full",
} as const;

/** The dotted plane every illustration sits on, so they read as one set. */
function CanvasGround() {
	return (
		<>
			<defs>
				<pattern
					id="empty-dots"
					width="16"
					height="16"
					patternUnits="userSpaceOnUse"
				>
					<circle cx="1.5" cy="1.5" r="1.5" className="fill-primary/15" />
				</pattern>
			</defs>
			<rect
				x="0.5"
				y="0.5"
				width="319"
				height="199"
				rx="16"
				className="fill-card stroke-border"
			/>
			<rect
				x="0.5"
				y="0.5"
				width="319"
				height="199"
				rx="16"
				fill="url(#empty-dots)"
			/>
		</>
	);
}

/** Roadmap: a milestone with epics fanned out beneath it. */
export function RoadmapIllustration() {
	return (
		<svg {...SVG_PROPS}>
			<title>A roadmap canvas</title>
			<CanvasGround />

			{/* The three trunks, drawn under the nodes they connect. */}
			<path
				d="M160 62 V80 M160 80 H72 V98 M160 80 H248 V98 M160 80 V98"
				className="stroke-primary/50"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
			{/* The feature spine under the middle epic. */}
			<path
				d="M160 130 V150 M160 150 H196 M160 150 V172 H196"
				className="stroke-border"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>

			<rect
				x="112"
				y="32"
				width="96"
				height="30"
				rx="9"
				className="fill-primary"
			/>
			<rect
				x="122"
				y="42"
				width="52"
				height="4"
				rx="2"
				className="fill-primary-foreground/80"
			/>
			<rect
				x="122"
				y="50"
				width="32"
				height="4"
				rx="2"
				className="fill-primary-foreground/45"
			/>

			{[32, 120, 208].map((x) => (
				<g key={x}>
					<rect
						x={x}
						y="98"
						width="80"
						height="32"
						rx="9"
						className="fill-muted stroke-border"
					/>
					<rect
						x={x + 10}
						y="108"
						width="42"
						height="4"
						rx="2"
						className="fill-muted-foreground/45"
					/>
					<rect
						x={x + 10}
						y="117"
						width="26"
						height="4"
						rx="2"
						className="fill-muted-foreground/25"
					/>
				</g>
			))}

			{[142, 164].map((y) => (
				<g key={y}>
					<rect
						x="196"
						y={y - 8}
						width="72"
						height="18"
						rx="6"
						className="fill-muted stroke-border"
					/>
					<rect
						x="204"
						y={y - 2}
						width="38"
						height="4"
						rx="2"
						className="fill-muted-foreground/35"
					/>
				</g>
			))}
		</svg>
	);
}

/** Board: three columns with cards, one of them mid-flight. */
export function BoardIllustration() {
	const columns = [
		{ x: 20, cards: 3 },
		{ x: 118, cards: 2 },
		{ x: 216, cards: 1 },
	];
	return (
		<svg {...SVG_PROPS}>
			<title>A board with cards in three columns</title>
			<CanvasGround />

			{columns.map((column) => (
				<g key={column.x}>
					<rect
						x={column.x}
						y="24"
						width="84"
						height="154"
						rx="12"
						className="fill-muted/60 stroke-border"
					/>
					<rect
						x={column.x + 12}
						y="36"
						width="34"
						height="5"
						rx="2.5"
						className="fill-muted-foreground/40"
					/>
					<rect
						x={column.x + 60}
						y="33"
						width="14"
						height="11"
						rx="5.5"
						className="fill-muted-foreground/15"
					/>

					{Array.from({ length: column.cards }, (_, i) => (
						<g key={`${column.x}-${i}`}>
							<rect
								x={column.x + 10}
								y={54 + i * 40}
								width="64"
								height="32"
								rx="8"
								className="fill-card stroke-border"
							/>
							<rect
								x={column.x + 18}
								y={62 + i * 40}
								width="38"
								height="4"
								rx="2"
								className="fill-muted-foreground/40"
							/>
							<rect
								x={column.x + 18}
								y={71 + i * 40}
								width="22"
								height="4"
								rx="2"
								className="fill-muted-foreground/22"
							/>
							<circle
								cx={column.x + 64}
								cy={73 + i * 40}
								r="5"
								className="fill-primary/25"
							/>
						</g>
					))}
				</g>
			))}

			{/* The card being dragged: lifted, tilted, and over the gutter. */}
			<g transform="rotate(-4 160 118)">
				<rect
					x="128"
					y="100"
					width="64"
					height="34"
					rx="8"
					className="fill-card stroke-primary"
				/>
				<rect
					x="136"
					y="109"
					width="38"
					height="4"
					rx="2"
					className="fill-primary/70"
				/>
				<rect
					x="136"
					y="118"
					width="24"
					height="4"
					rx="2"
					className="fill-muted-foreground/30"
				/>
				<circle cx="182" cy="120" r="5" className="fill-primary" />
			</g>
		</svg>
	);
}

/** Timeline: scheduled bars against a week grid, crossed by today. */
export function TimelineIllustration() {
	const bars = [
		{ y: 62, x: 78, w: 96, primary: true },
		{ y: 90, x: 118, w: 84, primary: false },
		{ y: 118, x: 168, w: 76, primary: false },
		{ y: 146, x: 232, w: 46, primary: true },
	];
	return (
		<svg {...SVG_PROPS}>
			<title>A timeline of scheduled work</title>
			<CanvasGround />

			{/* Week gridlines. */}
			{[78, 118, 158, 198, 238, 278].map((x) => (
				<line
					key={x}
					x1={x}
					y1="42"
					x2={x}
					y2="176"
					className="stroke-border"
					strokeWidth="1"
				/>
			))}
			{[78, 118, 158, 198, 238, 278].map((x) => (
				<rect
					key={`h${x}`}
					x={x + 6}
					y="30"
					width="16"
					height="4"
					rx="2"
					className="fill-muted-foreground/30"
				/>
			))}

			{bars.map((bar) => (
				<g key={bar.y}>
					{/* The row label in the gutter. */}
					<rect
						x="22"
						y={bar.y + 4}
						width="42"
						height="5"
						rx="2.5"
						className="fill-muted-foreground/30"
					/>
					<rect
						x={bar.x}
						y={bar.y}
						width={bar.w}
						height="14"
						rx="7"
						className={bar.primary ? "fill-primary" : "fill-primary/25"}
					/>
				</g>
			))}

			{/* The finish-to-start elbows. */}
			<path
				d="M174 69 H182 V97 H118 M202 97 H210 V125 H168 M244 125 H252 V153 H232"
				className="stroke-muted-foreground/35"
				strokeWidth="1.2"
				strokeLinecap="round"
			/>

			{/* Today. */}
			<line
				x1="205"
				y1="26"
				x2="205"
				y2="180"
				className="stroke-primary"
				strokeWidth="2"
				strokeLinecap="round"
			/>
			<rect
				x="188"
				y="16"
				width="34"
				height="16"
				rx="6"
				className="fill-primary"
			/>
			<rect
				x="195"
				y="22"
				width="20"
				height="4"
				rx="2"
				className="fill-primary-foreground/85"
			/>
		</svg>
	);
}

/** Deliverables: a submission sheet with criteria, accepted by a reviewer. */
export function DeliverablesIllustration() {
	return (
		<svg {...SVG_PROPS}>
			<title>A deliverable accepted by a reviewer</title>
			<CanvasGround />

			{/* The deliverable itself. */}
			<rect
				x="24"
				y="26"
				width="164"
				height="150"
				rx="12"
				className="fill-card stroke-border"
			/>
			<rect
				x="38"
				y="40"
				width="58"
				height="16"
				rx="6"
				className="fill-primary/15"
			/>
			<rect
				x="46"
				y="46"
				width="42"
				height="4"
				rx="2"
				className="fill-primary/70"
			/>
			<rect
				x="132"
				y="40"
				width="42"
				height="16"
				rx="8"
				className="fill-primary"
			/>
			<rect
				x="140"
				y="46"
				width="26"
				height="4"
				rx="2"
				className="fill-primary-foreground/85"
			/>

			<rect
				x="38"
				y="70"
				width="92"
				height="6"
				rx="3"
				className="fill-muted-foreground/45"
			/>
			<rect
				x="38"
				y="84"
				width="124"
				height="4"
				rx="2"
				className="fill-muted-foreground/22"
			/>

			{/* Acceptance criteria, all ticked. */}
			{[104, 128, 152].map((y, i) => (
				<g key={y}>
					<rect
						x="38"
						y={y - 6}
						width="136"
						height="20"
						rx="6"
						className="fill-muted/60"
					/>
					<path
						d={`M46 ${y + 4} l4 4 7-8`}
						className="stroke-success"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
					<rect
						x="64"
						y={y + 1}
						width={[86, 66, 76][i]}
						height="4"
						rx="2"
						className="fill-muted-foreground/30"
					/>
				</g>
			))}

			{/* The hand-off into review. */}
			<path
				d="M188 100 C 200 100, 202 92, 214 92"
				className="stroke-primary"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>

			{/* The reviewer, and the decision. */}
			<rect
				x="214"
				y="60"
				width="82"
				height="82"
				rx="12"
				className="fill-muted stroke-border"
			/>
			<circle
				cx="255"
				cy="88"
				r="14"
				className="fill-primary/15 stroke-primary"
				strokeWidth="1.5"
			/>
			<circle cx="255" cy="83" r="4.5" className="fill-primary" />
			<path d="M247 96 a8 8 0 0 1 16 0 z" className="fill-primary/70" />
			<rect
				x="234"
				y="112"
				width="42"
				height="5"
				rx="2.5"
				className="fill-muted-foreground/35"
			/>
			<circle cx="255" cy="130" r="9" className="fill-success" />
			<path
				d="M251 130 l3 3 5-6"
				className="stroke-background"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
