import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_IN_OUT, EASE_OUT, bezier, lerp, springIn } from "../anim";
import { PALETTE } from "../brand/palette";
import { CaptionTrack } from "../primitives/Caption";
import { Stage } from "../primitives/Stage";
import { Avatar, Badge, Bar, Card, CheckMark, Chip, Connector } from "../primitives/shapes";

/**
 * The consultant story: scope → roadmap → team → terms.
 *
 * These are the four moves the `#lead-engagements` divider already claims on
 * the page — "scope the work, staff it from the talent bench, sign the terms,
 * and own the outcome" — so the video states nothing the copy does not.
 *
 * The scope highlights inside the brief literally detach and become the epic
 * and features on the canvas, which is the one idea this story exists to land:
 * the roadmap is the brief, restructured.
 *
 * Same label discipline as the talent story: no invented numbers, no rates, no
 * fees, no timelines. Chips carry only real product nouns.
 */

const CAPTIONS = [
	{ eyebrow: "Scope", line: "Turn a brief into scoped work" },
	{ eyebrow: "Roadmap", line: "Epics, features, tasks — on a canvas" },
	{ eyebrow: "Team", line: "Staff it from a vetted talent bench" },
	{ eyebrow: "Terms", line: "Signed terms, acceptance you can point at" },
] as const;

/** The pose held at both ends of the loop. */
const SEED = { x: 660, y: 230, w: 600, h: 600 };

/** Brief content bars, in the order they are written. */
const BRIEF_BARS = [420, 360, 470, 300, 440, 380, 250] as const;

/** The three lines that get highlighted, then fly out to become canvas nodes. */
const SCOPE_ROWS = [1, 3, 5] as const;

export const ConsultantStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// ── The brief sheet slides left and shrinks so the canvas has room, then
	// slides back so the last frame matches the first. The return runs at
	// 286-306, while the sheet is still transparent, so the move is never seen —
	// without it the loop would jump 500px sideways.
	const shift = Math.min(
		lerp(frame, [84, 106], [0, 1], EASE_IN_OUT),
		lerp(frame, [286, 306], [1, 0], EASE_IN_OUT),
	);
	const scale = 1 - 0.42 * shift;
	const sx = SEED.x - 500 * shift;
	const sy = SEED.y + 120 * shift;
	const sw = SEED.w * scale;
	const sh = SEED.h * scale;
	const k = scale;

	// Torn back down for the loop return.
	const build = lerp(frame, [306, 320], [1, 0], EASE_OUT);
	const briefOut = lerp(frame, [252, 268], [1, 0], EASE_OUT);
	const briefBack = lerp(frame, [304, 320], [0, 1], EASE_OUT);
	const briefOpacity = Math.max(briefOut, briefBack);

	// ── The canvas. Slides left in beat 3 to clear room for the bench, and is
	// cleared entirely in beat 4 so the contract lands on empty ground.
	const roadmapIn = lerp(frame, [96, 112], [0, 1]);
	const rmShift = lerp(frame, [164, 184], [0, -260], EASE_IN_OUT);
	const roadmapOut = lerp(frame, [252, 272], [1, 0], EASE_OUT);

	// ── The bench.
	const benchIn = springIn(frame, fps, 168, 26);
	const benchOut = lerp(frame, [248, 262], [1, 0], EASE_OUT);
	const benchOpacity = benchIn * benchOut;
	const vetted = lerp(frame, [182, 198], [0, 1], EASE_OUT);

	// ── The contract.
	const contractIn = springIn(frame, fps, 256, 30);
	const contractOut = lerp(frame, [304, 320], [1, 0], EASE_OUT);
	const contractOpacity = contractIn * contractOut;
	const signature = lerp(frame, [278, 300], [0, 1], EASE_OUT);

	return (
		<Stage>
			{/* ---------- Canvas: epic → features → tasks ---------- */}
			<div
				style={{
					opacity: roadmapIn * roadmapOut,
					transform: `translateX(${rmShift}px)`,
				}}
			>
				<Connector
					d="M 960 322 C 960 380, 1050 428, 1120 428"
					progress={lerp(frame, [112, 130], [0, 1], EASE_OUT)}
					tone="muted"
				/>
				<Connector
					d="M 960 322 C 960 450, 1050 548, 1120 548"
					progress={lerp(frame, [118, 136], [0, 1], EASE_OUT)}
					tone="muted"
				/>
				{TASKS.map((task, i) => (
					<Connector
						key={task.y}
						// Control points stay in x-order (1400 then 1420) so the curve
						// cannot loop back on itself the way a crossed pair does.
						d={`M 1360 ${task.fromY} C 1400 ${task.fromY}, 1420 ${task.y + 28}, ${task.x} ${task.y + 28}`}
						progress={lerp(frame, [132 + i * 5, 150 + i * 5], [0, 1], EASE_OUT)}
						tone="muted"
					/>
				))}

				{/* Tasks spring in after the features have landed. */}
				{TASKS.map((task, i) => {
					const t = springIn(frame, fps, 128 + i * 5, 22);
					return (
						<div key={`${task.x}-${task.y}`} style={{ opacity: t }}>
							<Card x={task.x} y={task.y} w={200} h={56} radius={12} scale={0.9 + 0.1 * t} />
							<Chip
								x={task.x + 16}
								y={task.y + 6}
								label="Task"
								tone="muted"
								opacity={lerp(frame, [136 + i * 4, 150 + i * 4], [0, 1])}
							/>
						</div>
					);
				})}

				{/* The scope highlights, flown out of the brief into canvas nodes. */}
				{SCOPE_ROWS.map((row, i) => {
					const node = NODES[i];
					const t = lerp(frame, [98 + i * 6, 124 + i * 6], [0, 1], EASE_IN_OUT);
					const fromX = sx + 40 * k;
					const fromY = sy + (108 + row * 52) * k;
					const [px, py] = bezier(t, [fromX, fromY], [820, 240], [node.x, node.y]);
					const w = lerp(t, [0, 1], [BRIEF_BARS[row] * k, node.w]);
					const h = lerp(t, [0, 1], [22 * k, node.h]);
					return (
						<div key={node.label}>
							<Card
								x={px}
								y={py}
								w={w}
								h={h}
								radius={lerp(t, [0, 1], [8, 14])}
								tone={i === 0 ? "primary" : "surfaceHi"}
								opacity={i === 0 ? 0.9 : 1}
								glow={i === 0 ? 0.4 * t : 0}
							/>
							<Chip
								x={px + 18}
								y={py + h / 2 - 22}
								label={node.label}
								tone={i === 0 ? "primary" : "outline"}
								opacity={lerp(frame, [126 + i * 5, 140 + i * 5], [0, 1])}
							/>
						</div>
					);
				})}
			</div>

			{/* ---------- Brief sheet ---------- */}
			<div style={{ opacity: briefOpacity }}>
				<Card x={sx} y={sy} w={sw} h={sh} radius={24 * k} />
				{/* Title bar is the seed pose — always present. */}
				<Bar
					x={sx + 40 * k}
					y={sy + 56 * k}
					w={320 * k}
					h={18 * k}
					tone="ink"
					opacity={0.85}
				/>
				<Badge
					x={sx + sw - 96 * k}
					y={sy + 44 * k}
					r={30 * k}
					scale={springIn(frame, fps, 66, 22) * build}
				>
					<svg width={26 * k} height={26 * k} viewBox="0 0 24 24" fill="none">
						<title>scope</title>
						<path
							d="M5 12h13M13 6l6 6-6 6"
							stroke="#ffffff"
							strokeWidth={2.4}
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</Badge>

				{BRIEF_BARS.map((w, i) => {
					// The three scope rows leave the sheet once they fly out.
					const isScope = SCOPE_ROWS.indexOf(i as 1) !== -1;
					const scopeIdx = SCOPE_ROWS.indexOf(i as 1);
					const flown = isScope
						? lerp(frame, [98 + scopeIdx * 6, 110 + scopeIdx * 6], [1, 0])
						: 1;
					return (
						<Bar
							key={`${w}-${i}`}
							x={sx + 40 * k}
							y={sy + (108 + i * 52) * k}
							w={w * k}
							h={14 * k}
							reveal={lerp(frame, [8 + i * 4, 26 + i * 4], [0, 1]) * build}
							opacity={flown}
						/>
					);
				})}

				{/* Highlight blocks behind the scope rows — the emphasis, before it moves. */}
				{SCOPE_ROWS.map((row, i) => (
					<Card
						key={row}
						x={sx + 30 * k}
						y={sy + (100 + row * 52) * k}
						w={(BRIEF_BARS[row] + 24) * k}
						h={30 * k}
						radius={8}
						tone="primary"
						opacity={
							springIn(frame, fps, 46 + i * 6, 20) *
							build *
							lerp(frame, [96 + i * 6, 108 + i * 6], [0.28, 0])
						}
					/>
				))}

				<Chip
					x={sx + 40 * k}
					y={sy + sh - 76 * k}
					label="Scope"
					tone="outline"
					opacity={springIn(frame, fps, 62, 20) * build}
					scale={k}
				/>
			</div>

			{/* ---------- The vetted bench ---------- */}
			<div style={{ opacity: benchOpacity }}>
				<Card x={1560} y={280} w={280} h={500} radius={20} />
				<Bar x={1596} y={318} w={140} h={14} tone="ink" opacity={0.8} />
				<CheckMark x={1780} y={306} size={36} progress={vetted} tone="primary" />
				<Chip x={1596} y={348} label="Vetted" tone="outline" opacity={vetted} />
				{BENCH.map((seat, i) => {
					const t = springIn(frame, fps, 176 + i * 4, 20);
					// The three that get staffed dim out of the bench as they leave.
					const leaves = i < 3 ? lerp(frame, [196 + i * 14, 208 + i * 14], [1, 0]) : 1;
					return (
						<Avatar
							key={`${seat.x}-${seat.y}`}
							x={seat.x}
							y={seat.y}
							size={84}
							variant={(i % 3) as 0 | 1 | 2}
							scale={t}
							opacity={t * leaves * (i < 3 ? 1 : lerp(frame, [232, 248], [1, 0.4]))}
						/>
					);
				})}
			</div>

			{/* Three of them fly onto task rows. */}
			<div style={{ opacity: roadmapOut }}>
				{BENCH.slice(0, 3).map((seat, i) => {
					const t = lerp(frame, [198 + i * 14, 224 + i * 14], [0, 1], EASE_IN_OUT);
					const task = TASKS[i];
					// Docks just clear of the task card's left edge, and carries the
					// canvas's own shift so it stays glued to the row it landed on.
					const [px, py] = bezier(
						t,
						[seat.x, seat.y],
						[1500, 250],
						[task.x + rmShift - 100, task.y - 14],
					);
					return (
						<Avatar
							key={`fly-${seat.x}-${seat.y}`}
							x={px}
							y={py}
							size={84}
							variant={(i % 3) as 0 | 1 | 2}
							scale={lerp(t, [0, 1], [1, 0.72])}
							ring={lerp(frame, [220 + i * 14, 234 + i * 14], [0, 1])}
							opacity={lerp(frame, [196 + i * 14, 206 + i * 14], [0, 1])}
						/>
					);
				})}
			</div>

			{/* ---------- The signed contract ---------- */}
			<div style={{ opacity: contractOpacity }}>
				<Card
					x={640}
					y={lerp(contractIn, [0, 1], [1140, 330])}
					w={620}
					h={420}
					radius={20}
					glow={0.45 * contractIn}
				/>
				<div
					style={{
						position: "absolute",
						left: 640,
						top: lerp(contractIn, [0, 1], [1140, 330]),
						width: 620,
						height: 420,
					}}
				>
					<Bar x={40} y={44} w={240} h={16} tone="ink" opacity={0.85} />
					{[380, 300, 340].map((w, i) => (
						<Bar
							key={w}
							x={40}
							y={92 + i * 30}
							w={w}
							h={11}
							reveal={lerp(frame, [262 + i * 5, 280 + i * 5], [0, 1])}
						/>
					))}

					{/* The signature, drawn — the shape from SignedContractIcon, scaled up. */}
					<svg
						style={{ position: "absolute", left: 40, top: 208 }}
						width={420}
						height={110}
						viewBox="0 0 420 110"
						fill="none"
					>
						<title>signature</title>
						<path
							d="M8 82 C 48 14, 82 14, 104 54 C 126 94, 162 94, 184 56 C 206 18, 244 20, 282 68 C 304 96, 336 88, 380 26"
							stroke={PALETTE.blue500}
							strokeWidth={6}
							strokeLinecap="round"
							strokeLinejoin="round"
							fill="none"
							pathLength={1}
							strokeDasharray={1}
							strokeDashoffset={1 - signature}
						/>
					</svg>
					<Bar x={40} y={326} w={420} h={2} tone="muted" opacity={0.6} />

					<Chip
						x={40}
						y={352}
						label="Signed"
						tone="primary"
						opacity={springIn(frame, fps, 292, 20)}
					/>
					<Chip
						x={190}
						y={352}
						label="Accepted"
						tone="outline"
						opacity={springIn(frame, fps, 298, 20)}
					/>

					<Badge x={508} y={44} r={40} scale={springIn(frame, fps, 288, 22)}>
						<svg width="34" height="34" viewBox="0 0 24 24" fill="none">
							<title>signed</title>
							<path
								d="M4 20l4-1 10-10a2.1 2.1 0 0 0-3-3L5 16l-1 4z"
								fill="#ffffff"
							/>
						</svg>
					</Badge>
				</div>
			</div>

			<CaptionTrack items={CAPTIONS} />
		</Stage>
	);
};

const NODES = [
	{ label: "Epic", x: 820, y: 250, w: 280, h: 72 },
	{ label: "Feature", x: 1120, y: 396, w: 240, h: 64 },
	{ label: "Feature", x: 1120, y: 516, w: 240, h: 64 },
] as const;

/**
 * Tasks sit 100px clear of the features' right edge (1360). A tighter gap than
 * the connector's control-point offsets forces the curve to double back.
 * `fromY` is the centre of the parent feature.
 */
const TASKS = [
	{ x: 1460, y: 366, fromY: 428 },
	{ x: 1460, y: 446, fromY: 428 },
	{ x: 1460, y: 526, fromY: 548 },
	{ x: 1460, y: 606, fromY: 548 },
] as const;

const BENCH = [
	{ x: 1600, y: 410 },
	{ x: 1710, y: 410 },
	{ x: 1600, y: 520 },
	{ x: 1710, y: 520 },
	{ x: 1600, y: 630 },
	{ x: 1710, y: 630 },
] as const;

/** Rendered inside AbsoluteFill so the stage is exactly 1920x1080. */
export const ConsultantStage: React.FC = () => (
	<AbsoluteFill>
		<ConsultantStory />
	</AbsoluteFill>
);
