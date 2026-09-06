import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_IN_OUT, EASE_OUT, lerp, springIn } from "../anim";
import { FONT_BODY } from "../brand/fonts";
import { LIGHT_PALETTE, usePalette } from "../brand/palette";
import { CaptionTrack } from "../primitives/Caption";
import { Stage } from "../primitives/Stage";
import { Avatar, Bar, Card, CheckMark, Chip } from "../primitives/shapes";

/**
 * The board empty-state clip: columns → a card → it moves → it lands done.
 *
 * The whole point of a board is that a card CHANGES COLUMN, which no static
 * screenshot of an empty board can show. So one card is followed door to door:
 * it is created in To do, an owner docks onto it, it slides into In progress,
 * and it ticks into Done.
 *
 * LABEL DISCIPLINE: the three column names are the board's real statuses, and
 * the card carries "Task" — the node kind — rather than an invented title.
 *
 * LIGHT palette: embedded inside the app shell. See McpStory's note.
 */

const CAPTIONS = [
	{ eyebrow: "Board", line: "Every task, in the column it's in" },
	{ eyebrow: "Assign", line: "Give it an owner and a due date" },
	{ eyebrow: "Move", line: "Drag it forward as the work lands" },
	{ eyebrow: "Done", line: "Progress rolls straight up the roadmap" },
] as const;

const COLUMNS = [
	{ label: "To do", x: 190 },
	{ label: "In progress", x: 760 },
	{ label: "Done", x: 1330 },
] as const;
const COL_Y = 190;
const COL_W = 400;
const COL_H = 560;

/**
 * Where the travelling card rests in each column, in order.
 *
 * It sits at the BOTTOM of the stack, not the top: a card leaving from the top
 * leaves a hole above cards that stay, which no real board would show.
 */
const STOPS = [
	{ x: 220, y: 548 },
	{ x: 790, y: 548 },
	{ x: 1360, y: 548 },
] as const;
const CARD_W = 340;
const CARD_H = 132;

/** The two hand-offs: To do → In progress, then → Done. */
const MOVES = [
	{ from: 0, to: 1, at: 150 },
	{ from: 1, to: 2, at: 246 },
] as const;

/** Cards that just sit there, so the columns are not one lonely card each. */
const FILLER = [
	{ col: 0, y: 300, at: 40, w: 340 },
	{ col: 0, y: 424, at: 52, w: 340 },
	{ col: 1, y: 300, at: 64, w: 340 },
	{ col: 2, y: 300, at: 76, w: 340 },
] as const;

export const BoardEmptyStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const out = lerp(frame, [298, 314], [1, 0], EASE_OUT);
	const cardIn = springIn(frame, fps, 26, 24);

	// The card's position: it rests in a stop until a move fires, then eases
	// across. Written as a fold so a third column would cost one array entry.
	let cx: number = STOPS[0].x;
	let cy: number = STOPS[0].y;
	let lift = 0;
	for (let i = 0; i < MOVES.length; i++) {
		const move = MOVES[i];
		const t = lerp(frame, [move.at, move.at + 30], [0, 1], EASE_IN_OUT);
		cx = lerp(t, [0, 1], [STOPS[move.from].x, STOPS[move.to].x]);
		cy = lerp(t, [0, 1], [STOPS[move.from].y, STOPS[move.to].y]);
		// Picked up and put down: the arc is what makes it read as a drag.
		lift = Math.sin(Math.PI * t) * 26;
		if (frame < move.at + 30) break;
	}

	const owner = lerp(frame, [104, 126], [0, 1], EASE_OUT);
	const due = lerp(frame, [116, 138], [0, 1], EASE_OUT);
	const tick = lerp(frame, [282, 300], [0, 1], EASE_OUT);
	// The dragged card floats above its column while it is in flight.
	const dragging = lift / 26;

	return (
		<Stage palette={LIGHT_PALETTE}>
			<div style={{ opacity: out }}>
				{/* ---------- Columns ---------- */}
				{COLUMNS.map((column, i) => {
					const colIn = springIn(frame, fps, 6 + i * 8, 26);
					return (
						<div key={column.label} style={{ opacity: colIn }}>
							<Card
								x={column.x}
								y={COL_Y}
								w={COL_W}
								h={COL_H}
								tone="surface"
								radius={22}
								scale={0.96 + 0.04 * colIn}
							/>
							<ColumnHeader
								x={column.x + 28}
								y={COL_Y + 26}
								label={column.label}
								// Only the column the card is currently in counts it.
								count={countFor(i, frame)}
							/>
						</div>
					);
				})}

				{/* ---------- The cards that stay put ---------- */}
				{FILLER.map((filler) => {
					const fillIn = springIn(frame, fps, filler.at, 22);
					return (
						<div key={`filler-${filler.col}-${filler.y}`} style={{ opacity: fillIn * 0.85 }}>
							<Card
								x={COLUMNS[filler.col].x + 30}
								y={filler.y}
								w={filler.w}
								h={96}
								radius={16}
								tone="surfaceHi"
								scale={0.95 + 0.05 * fillIn}
							/>
							<Bar x={COLUMNS[filler.col].x + 56} y={filler.y + 30} w={220} h={11} />
							<Bar x={COLUMNS[filler.col].x + 56} y={filler.y + 58} w={140} h={9} />
						</div>
					);
				})}

				{/* ---------- The card being followed ---------- */}
				<div
					style={{
						opacity: cardIn,
						transform: `translateY(${-lift}px)`,
					}}
				>
					<Card
						x={cx}
						y={cy}
						w={CARD_W}
						h={CARD_H}
						radius={16}
						tone="surfaceHi"
						glow={dragging * 0.5}
						scale={0.94 + 0.06 * cardIn + 0.02 * dragging}
					/>
					<Chip x={cx + 20} y={cy + 16} label="Task" tone="primary" />
					<Bar x={cx + 20} y={cy + 76} w={200} h={11} reveal={lerp(frame, [40, 62], [0, 1], EASE_OUT)} />
					<Bar x={cx + 20} y={cy + 102} w={130} h={9} reveal={due} opacity={0.9} />
					<Avatar
						x={cx + CARD_W - 78}
						y={cy + 62}
						size={58}
						variant={1}
						opacity={owner}
						scale={0.7 + 0.3 * owner}
					/>
					<CheckMark x={cx + CARD_W - 74} y={cy + 8} size={48} progress={tick} tone="ok" />
				</div>
			</div>

			<CaptionTrack items={CAPTIONS} />
		</Stage>
	);
};

/**
 * The count badge on a column header.
 *
 * It has to move with the card — a board whose "Done" column reads 0 while a
 * ticked card sits in it is exactly the detail that makes a mock look fake.
 */
function countFor(column: number, frame: number): number {
	const base = [2, 1, 1][column];
	let held = 0;
	for (let i = 0; i < MOVES.length; i++) {
		if (frame >= MOVES[i].at + 15) held = MOVES[i].to;
	}
	return base + (held === column ? 1 : 0);
}

const ColumnHeader: React.FC<{
	x: number;
	y: number;
	label: string;
	count: number;
}> = ({ x, y, label, count }) => {
	const PALETTE = usePalette();
	return (
		<div
			style={{
				position: "absolute",
				left: x,
				top: y,
				display: "flex",
				alignItems: "center",
				gap: 14,
				fontFamily: FONT_BODY,
				fontSize: 24,
				fontWeight: 700,
				letterSpacing: "0.08em",
				textTransform: "uppercase",
				color: PALETTE.inkMuted,
			}}
		>
			{label}
			<span
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					minWidth: 36,
					height: 36,
					padding: "0 10px",
					borderRadius: 18,
					backgroundColor: PALETTE.chipMuted,
					fontSize: 22,
					letterSpacing: 0,
					color: PALETTE.inkMuted,
				}}
			>
				{count}
			</span>
		</div>
	);
};

/** Rendered inside AbsoluteFill so the stage is exactly 1920x1080. */
export const BoardEmptyStage: React.FC = () => (
	<AbsoluteFill>
		<BoardEmptyStory />
	</AbsoluteFill>
);
