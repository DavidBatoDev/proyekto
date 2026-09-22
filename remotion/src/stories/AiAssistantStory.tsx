import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_IN_OUT, EASE_OUT, lerp, springIn } from "../anim";
import { LIGHT_PALETTE, usePalette } from "../brand/palette";
import { CaptionTrack } from "../primitives/Caption";
import { Stage } from "../primitives/Stage";
import {
	Badge,
	Bar,
	Bubble,
	Card,
	CheckMark,
	Chip,
	Connector,
} from "../primitives/shapes";

/**
 * The assistant clip: ask → propose → review the diff → commit.
 *
 * The section's whole claim is that the assistant does not touch your roadmap
 * until you have seen what it wants to do. That is a two-stage flow, and a
 * screenshot can only ever catch one of the two stages — which is the reason
 * this is a clip and not an image.
 *
 * THE DIM ROADMAP IS THE POINT. The tree on the left is up from the first beat
 * at 42% and is not scenery: at the commit it lifts to full and gains a node in
 * the same frames, so cause and effect are legible without a cut. Introducing
 * the tree only at beat 4 would read as the assistant conjuring a roadmap
 * rather than editing the one that was already there.
 *
 * The proposal is the assistant's MESSAGE, not a bubble describing one —
 * `AiPlanProposalCard` renders exactly that way inside an assistant turn. It
 * also spares the clip from inventing prose for the assistant to say: the card
 * speaks in three op chips and a bar per affected node, and a bar cannot
 * promise a node title the product never wrote.
 *
 * LABEL DISCIPLINE: "Plan proposal" is the card's own badge in
 * AiPlanProposalCard.tsx, "Assistant" is the turn label in AiMessage.tsx, and
 * "Add" / "Move" / "Rename" are the readable forms of `add_epic`, `move_node`
 * and `update_node` from schemas/roadmap-ai-operations.json. Everything else is
 * a node kind. The one free-form string is the request itself, kept flat and
 * generic — a request is the only thing on this screen a person would type.
 *
 * Beat 3 is deliberately the slowest: the tick, the hop between two slots and
 * the rewritten name land twenty-odd frames apart rather than together, and
 * each row's accent releases to half once it has been read. Three rows lighting
 * at once would be a result appearing; one at a time is someone reading.
 *
 * LIGHT palette, like McpStory and the four empty states: this sits on a
 * marketing page beside three other light clips, where a navy slab would read
 * as a foreign object. See brand/palette.ts.
 *
 * Every scene element reads the GLOBAL frame and lives outside every
 * <Sequence>; only <CaptionTrack> is wrapped, because inside a Sequence
 * `useCurrentFrame()` is beat-local and the commit has to know what the ask did.
 */

const CAPTIONS = [
	{ eyebrow: "Ask", line: "Tell it what to change" },
	{ eyebrow: "Propose", line: "It drafts the operations first" },
	{ eyebrow: "Review", line: "Read the diff before it lands" },
	{ eyebrow: "Commit", line: "Approve it and the roadmap updates" },
] as const;

/** The two halves: the roadmap being edited, and the thread doing the editing. */
const TREE = { x: 120, y: 150, w: 580, h: 630 } as const;
const PANEL = { x: 760, y: 150, w: 1040, h: 630 } as const;

const MILESTONE = { x: 152, y: 248, w: 516, h: 72 } as const;
/** One spine down the left with an elbow into each node, as on the canvas. */
const SPINE_X = 180;
const NODE = { x: 196, w: 472, h: 68 } as const;
/** The three nodes that exist before the assistant is asked anything. */
const NODE_Y = [372, 460, 548] as const;
/** Where the committed epic lands — the next slot down, not a gap in the middle. */
const NEW_NODE_Y = 636;

const PLAN = { x: 790, y: 344, w: 880, h: 352 } as const;
const ROW = { x: 814, w: 832, h: 56 } as const;

/**
 * The three operations, in the order the assistant emits them. `at` is the
 * frame the row springs in; the review accents are derived from the index so
 * they stay 24 frames apart however the rows are re-timed.
 */
const OPS = [
	{ kind: "Add", y: 420, nameW: 260 },
	{ kind: "Move", y: 488, nameW: 210 },
	{ kind: "Rename", y: 556, nameW: 200 },
] as const;

/** The Move row's two slots: where the node is, and where it is going. */
const SLOT_A = 1300;
const SLOT_B = 1480;
const SLOT_W = 110;

const COMMIT = { x: 814, y: 628 } as const;

export const AiAssistantStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// The scene is torn down before the loop point, so frame 329 and frame 0 are
	// the same empty ground and the cut between them is invisible.
	const out = lerp(frame, [298, 314], [1, 0], EASE_OUT);

	const treeIn = springIn(frame, fps, 6, 26);
	const milestoneIn = springIn(frame, fps, 12, 24);
	const panelIn = springIn(frame, fps, 14, 26);
	const composerIn = springIn(frame, fps, 20, 24);
	const sendIn = springIn(frame, fps, 24, 22);

	// Typed, then emptied by the send: the composer going blank is what makes the
	// bubble read as having been sent rather than as having always been there.
	const typing =
		lerp(frame, [26, 50], [0, 1], EASE_OUT) *
		(1 - lerp(frame, [52, 58], [0, 1], EASE_OUT));
	const askIn = springIn(frame, fps, 56, 22);
	const askLabel = lerp(frame, [60, 82], [0, 1], EASE_OUT);

	// The dots hold the turn while the assistant works. Without them the proposal
	// arrives in the same instant as the question and reads as canned.
	const thinking = Math.min(
		lerp(frame, [88, 96], [0, 1]),
		lerp(frame, [104, 112], [1, 0]),
	);

	const planIn = springIn(frame, fps, 110, 26);
	const commitIn = springIn(frame, fps, 158, 22);

	// ── Beat 3, the diff, one accent at a time.
	const addTick = lerp(frame, [176, 198], [0, 1], EASE_OUT);
	const moveWire = lerp(frame, [196, 220], [0, 1], EASE_OUT);
	const moveHop = lerp(frame, [200, 226], [0, 1], EASE_IN_OUT);
	// The node token sits dim in its old slot until the move is the thing being
	// read — at full primary it is the loudest mark in a beat that is not its own.
	const moveLight = 0.5 + 0.5 * lerp(frame, [194, 206], [0, 1], EASE_OUT);
	// The two bars overlap by four frames. A clean hand-off leaves the row empty
	// for long enough to read as a missing value rather than as a rename.
	const renameOut = 1 - lerp(frame, [216, 230], [0, 1], EASE_OUT);
	const renameIn = lerp(frame, [226, 244], [0, 1], EASE_OUT);

	// ── Beat 4. The button is primary from the moment the plan exists and only
	// dim: a plan you cannot yet see a way to apply is a worse lie than a pale
	// one, and a muted chip is invisible against this card's own fill anyway.
	const commitLight = lerp(frame, [250, 262], [0.45, 1], EASE_OUT);
	const press =
		lerp(frame, [250, 255], [0, 1], EASE_OUT) *
		lerp(frame, [255, 262], [1, 0], EASE_OUT);
	// Gated on both ends: a bare descending lerp would be fully lit at frame 0.
	const ring = Math.min(
		lerp(frame, [250, 254], [0, 1]),
		lerp(frame, [254, 276], [1, 0], EASE_OUT),
	);
	// The plan settles back once it has been applied and the roadmap takes over.
	const settle = lerp(frame, [266, 290], [1, 0.78], EASE_OUT);
	const lift = lerp(frame, [252, 278], [0.42, 1], EASE_OUT);
	const commitWire = lerp(frame, [258, 284], [0, 1], EASE_OUT);
	const newIn = springIn(frame, fps, 264, 26);
	const newWire = lerp(frame, [262, 286], [0, 1], EASE_OUT);

	return (
		<Stage palette={LIGHT_PALETTE}>
			<div style={{ opacity: out }}>
				{/* ---------- The roadmap, dim until it is edited ---------- */}
				<div style={{ opacity: lift }}>
					<div style={{ opacity: treeIn }}>
						<Card
							x={TREE.x}
							y={TREE.y}
							w={TREE.w}
							h={TREE.h}
							radius={24}
							scale={0.96 + 0.04 * treeIn}
						/>
						<Chip
							x={TREE.x + 32}
							y={TREE.y + 26}
							label="Roadmap"
							tone="outline"
						/>
					</div>

					<div style={{ opacity: milestoneIn }}>
						<Card
							x={MILESTONE.x}
							y={MILESTONE.y}
							w={MILESTONE.w}
							h={MILESTONE.h}
							radius={16}
							tone="surfaceHi"
							scale={0.95 + 0.05 * milestoneIn}
						/>
						<Chip
							x={MILESTONE.x + 20}
							y={MILESTONE.y + 14}
							label="Milestone"
							tone="primary"
						/>
						<Bar
							x={MILESTONE.x + 190}
							y={MILESTONE.y + 31}
							w={200}
							h={11}
							reveal={lerp(frame, [24, 46], [0, 1], EASE_OUT)}
						/>
					</div>

					{NODE_Y.map((y, i) => {
						const at = 18 + i * 8;
						const nodeIn = springIn(frame, fps, at, 24);
						return (
							<div key={`node-${y}`}>
								<Connector
									d={spine(y)}
									progress={lerp(frame, [at - 6, at + 18], [0, 1], EASE_OUT)}
									tone="muted"
									width={2}
								/>
								<div style={{ opacity: nodeIn }}>
									<Card
										x={NODE.x}
										y={y}
										w={NODE.w}
										h={NODE.h}
										radius={14}
										tone="surfaceHi"
										scale={0.95 + 0.05 * nodeIn}
									/>
									<Chip x={NODE.x + 18} y={y + 12} label="Epic" tone="outline" />
									<Bar
										x={NODE.x + 128}
										y={y + 29}
										w={[220, 180, 240][i]}
										h={10}
										reveal={lerp(frame, [at + 10, at + 32], [0, 1], EASE_OUT)}
									/>
								</div>
							</div>
						);
					})}

					{/* The node the commit creates. Same shape as its siblings, primary
					    chip — it is new, not different. */}
					{/* Its wire branches off the LAST node rather than off the milestone:
					    reusing the full spine would repaint the whole trunk primary and
					    leave the existing elbows looking like a different tree. */}
					<Connector
						d={`M ${SPINE_X} ${NODE_Y[2] + NODE.h / 2} L ${SPINE_X} ${NEW_NODE_Y + NODE.h / 2} L ${NODE.x} ${NEW_NODE_Y + NODE.h / 2}`}
						progress={newWire}
						tone="primary"
						width={2}
					/>
					<div style={{ opacity: newIn }}>
						<Card
							x={NODE.x}
							y={NEW_NODE_Y}
							w={NODE.w}
							h={NODE.h}
							radius={14}
							tone="surfaceHi"
							glow={0.4 * newIn}
							scale={0.94 + 0.06 * newIn}
						/>
						<Chip
							x={NODE.x + 18}
							y={NEW_NODE_Y + 12}
							label="Epic"
							tone="primary"
						/>
						<Bar
							x={NODE.x + 128}
							y={NEW_NODE_Y + 29}
							w={210}
							h={10}
							reveal={lerp(frame, [274, 294], [0, 1], EASE_OUT)}
						/>
					</div>
				</div>

				{/* ---------- The thread ---------- */}
				<div style={{ opacity: panelIn }}>
					<Card
						x={PANEL.x}
						y={PANEL.y}
						w={PANEL.w}
						h={PANEL.h}
						radius={24}
						scale={0.96 + 0.04 * panelIn}
					/>
					<Chip
						x={PANEL.x + 32}
						y={PANEL.y + 26}
						label="Assistant"
						tone="outline"
					/>
				</div>

				{/* What the person asked for. Flat and generic on purpose. */}
				<Bubble
					x={1380}
					y={232}
					w={380}
					h={64}
					tone="user"
					label="Add a checkout epic"
					labelReveal={askLabel}
					opacity={askIn}
					scale={0.92 + 0.08 * askIn}
				/>

				<ThinkingDots frame={frame} x={806} y={318} opacity={thinking} />

				{/* ---------- The proposal, which is the assistant's turn ---------- */}
				<div style={{ opacity: planIn * settle }}>
					<Card
						x={PLAN.x}
						y={PLAN.y}
						w={PLAN.w}
						h={PLAN.h}
						radius={18}
						tone="surfaceHi"
						scale={0.96 + 0.04 * planIn}
					/>
					<Chip
						x={PLAN.x + 24}
						y={PLAN.y + 20}
						label="Plan proposal"
						tone="primary"
					/>

					{OPS.map((op, i) => {
						const at = 122 + i * 12;
						const rowIn = springIn(frame, fps, at, 22);
						const nameReveal = lerp(
							frame,
							[at + 10, at + 32],
							[0, 1],
							EASE_OUT,
						);
						// The row being read right now. It rises to full and then releases
						// to half, so the accent walks down the list instead of three
						// rows ending the beat equally lit. The floor is the alpha of a
						// hairline, so the rim is continuous rather than switching on.
						const readAt = 172 + i * 24;
						const review = Math.min(
							lerp(frame, [readAt, readAt + 18], [0, 1], EASE_OUT),
							lerp(frame, [readAt + 30, readAt + 48], [1, 0.45], EASE_OUT),
						);
						return (
							<div key={op.kind} style={{ opacity: rowIn }}>
								<Card
									x={ROW.x}
									y={op.y}
									w={ROW.w}
									h={ROW.h}
									radius={12}
									tone="surface"
									glow={review * 0.32}
									borderColor={`rgba(${LIGHT_PALETTE.glowRgb},${0.08 + 0.42 * review})`}
									scale={0.97 + 0.03 * rowIn}
								/>
								<Chip x={ROW.x + 20} y={op.y + 6} label={op.kind} />
								<Bar
									x={ROW.x + 170}
									y={op.y + 22}
									w={op.nameW}
									h={11}
									reveal={
										i === 2 ? Math.min(nameReveal, renameOut) : nameReveal
									}
								/>
								{/* Rename: the old name wipes out, the new one writes itself in
								    its place. Two bars, never a crossfade — overlapping them
								    reads as one smeared value. */}
								{i === 2 ? (
									<Bar
										x={ROW.x + 170}
										y={op.y + 22}
										w={268}
										h={11}
										tone="primary"
										reveal={renameIn}
										opacity={0.9}
									/>
								) : null}
								{i === 0 ? (
									<CheckMark
										x={ROW.x + ROW.w - 64}
										y={op.y + 8}
										size={40}
										progress={addTick}
									/>
								) : null}
								{i === 1 ? (
									<MoveSlots
										y={op.y}
										wire={moveWire}
										hop={moveHop}
										light={moveLight}
										rowIn={rowIn}
									/>
								) : null}
							</div>
						);
					})}

					<div style={{ opacity: commitIn }}>
						<Chip
							x={COMMIT.x}
							y={COMMIT.y}
							label="Commit"
							tone="primary"
							opacity={commitLight}
							scale={1 - 0.05 * press}
						/>
						<CommitRing x={COMMIT.x} y={COMMIT.y} opacity={ring} />
					</div>
				</div>

				{/* ---------- The composer ---------- */}
				<div style={{ opacity: composerIn }}>
					<Card
						x={790}
						y={716}
						w={880}
						h={56}
						radius={28}
						tone="surfaceHi"
						opacity={0.9}
					/>
					<Bar x={818} y={738} w={300} h={10} reveal={typing} />
				</div>
				<Badge x={1620} y={724} r={20} scale={0.9 + 0.1 * sendIn} opacity={sendIn}>
					<svg width={20} height={20} viewBox="0 0 24 24" fill="none">
						<title>send</title>
						<path
							d="M5 12h13M12 5l7 7-7 7"
							stroke="#ffffff"
							strokeWidth={2}
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</Badge>

				{/* The thread from the Add row to the node it created. Drawn last so it
				    crosses both panels — it is the one line that says the commit and
				    the new epic are the same event. */}
				<Connector
					d={`M ${ROW.x - 2} ${OPS[0].y + ROW.h / 2} C 730 ${OPS[0].y + ROW.h / 2}, 730 ${NEW_NODE_Y + NODE.h / 2}, ${NODE.x + NODE.w + 8} ${NEW_NODE_Y + NODE.h / 2}`}
					progress={commitWire}
					tone="primary"
					width={3}
				/>
			</div>

			<CaptionTrack items={CAPTIONS} />
		</Stage>
	);
};

/** The elbow from the milestone's spine into a node row. */
function spine(y: number): string {
	return `M ${SPINE_X} ${MILESTONE.y + MILESTONE.h} L ${SPINE_X} ${y + NODE.h / 2} L ${NODE.x} ${y + NODE.h / 2}`;
}

/**
 * The Move row's diff: two slots and the hop between them.
 *
 * A move is the one operation whose meaning is a *pair* of positions, so the
 * row shows both and lets the viewer watch the node leave one and arrive in the
 * other. The vacated slot stays behind as an empty outline — it is what makes
 * the arrival read as a move and not as a second node being added.
 */
const MoveSlots: React.FC<{
	y: number;
	wire: number;
	hop: number;
	light: number;
	rowIn: number;
}> = ({ y, wire, hop, light, rowIn }) => (
	<>
		<Card
			x={SLOT_A}
			y={y + 14}
			w={SLOT_W}
			h={28}
			radius={8}
			tone="surfaceHi"
			scale={0.9 + 0.1 * rowIn}
		/>
		<Card
			x={SLOT_B}
			y={y + 14}
			w={SLOT_W}
			h={28}
			radius={8}
			tone="surfaceHi"
			scale={0.9 + 0.1 * rowIn}
		/>
		<Connector
			d={`M ${SLOT_A + SLOT_W + 2} ${y + 28} C ${SLOT_A + SLOT_W + 22} ${y + 8}, ${SLOT_B - 22} ${y + 8}, ${SLOT_B - 2} ${y + 28}`}
			progress={wire}
			tone="primary"
			width={2}
		/>
		<Bar
			x={lerp(hop, [0, 1], [SLOT_A + 20, SLOT_B + 20])}
			// Lifted over the wire mid-flight, so it travels rather than slides.
			y={y + 23 - 10 * Math.sin(Math.PI * hop)}
			w={70}
			h={10}
			tone="primary"
			opacity={light}
		/>
	</>
);

/**
 * The ring a press leaves behind. A rounded rect rather than the circle
 * `CallBadge` uses, because it has to echo the shape of the chip underneath.
 */
const CommitRing: React.FC<{ x: number; y: number; opacity: number }> = ({
	x,
	y,
	opacity,
}) => {
	const PALETTE = usePalette();
	return (
		<div
			style={{
				position: "absolute",
				left: x - 10,
				top: y - 8,
				width: 148,
				height: 60,
				borderRadius: 30,
				border: `2px solid ${PALETTE.blue400}`,
				opacity: opacity * 0.6,
				transform: `scale(${1 + 0.35 * (1 - opacity)})`,
				transformOrigin: "center center",
			}}
		/>
	);
};

/**
 * The three dots a thread shows while the other side is working. McpStory keeps
 * its own copy private; this one differs only in that it holds the turn between
 * a request and a *proposal* rather than between a question and an answer.
 */
const ThinkingDots: React.FC<{
	frame: number;
	x: number;
	y: number;
	opacity: number;
}> = ({ frame, x, y, opacity }) => {
	const PALETTE = usePalette();
	return (
		<div style={{ opacity }}>
			{[0, 1, 2].map((i) => {
				// One 24-frame cycle per dot, staggered by 8 — the classic pulse.
				const phase = (frame - i * 8) % 24;
				const lift =
					lerp(phase, [0, 8], [0, 1], EASE_OUT) *
					lerp(phase, [8, 18], [1, 0], EASE_OUT);
				return (
					<div
						key={i}
						style={{
							position: "absolute",
							left: x + i * 26,
							top: y - 4 * lift,
							width: 14,
							height: 14,
							borderRadius: 7,
							backgroundColor: PALETTE.inkMuted,
							opacity: 0.4 + 0.6 * lift,
						}}
					/>
				);
			})}
		</div>
	);
};

/** Rendered inside AbsoluteFill so the stage is exactly 1920x1080. */
export const AiAssistantStage: React.FC = () => (
	<AbsoluteFill>
		<AiAssistantStory />
	</AbsoluteFill>
);
