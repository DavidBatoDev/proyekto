import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_OUT, lerp, springIn } from "../anim";
import { LIGHT_PALETTE } from "../brand/palette";
import { CaptionTrack } from "../primitives/Caption";
import { Stage } from "../primitives/Stage";
import {
	Avatar,
	Badge,
	Bar,
	Card,
	CheckMark,
	Chip,
	Connector,
} from "../primitives/shapes";

/**
 * The deliverables empty-state clip: define -> link -> review -> accepted.
 *
 * A deliverable is the one object in the product that carries an *acceptance*
 * decision, so the clip is built around the criteria list ticking and the
 * status chip crossing from In review to Approved. Everything else on screen —
 * the linked roadmap work, the reviewer — exists to make that decision look
 * like something a named person actually made.
 *
 * LABEL DISCIPLINE: the status chips are the real pipeline column labels out
 * of `deliveryModel.ts` (Not started / In progress / In review / Approved),
 * and the linked rows carry the node kinds `deliverable_links` accepts
 * (feature, task, milestone). No criterion text is invented — the criteria are
 * bars, because a fabricated acceptance line is exactly the sort of thing a
 * viewer would read as a promise.
 *
 * LIGHT palette: embedded inside the app shell. See the note on McpStory.
 */

const CAPTIONS = [
	{ eyebrow: "Define", line: "Name what the project hands over" },
	{ eyebrow: "Link", line: "Attach the roadmap work behind it" },
	{ eyebrow: "Review", line: "Send it to the people who sign off" },
	{ eyebrow: "Accepted", line: "Acceptance, recorded and attributed" },
] as const;

/**
 * Both panels stop at y=770. The caption baseline sits at 812 (see
 * primitives/Caption.tsx), so a 620-tall panel would have the eyebrow printed
 * over its bottom-left corner.
 */
const SHEET = { x: 250, y: 210, w: 720, h: 560 } as const;
const PANEL = { x: 1090, y: 210, w: 580, h: 560 } as const;

/** The acceptance criteria, ticking one at a time across beats 3 and 4. */
const CRITERIA = [
	{ w: 300, at: 196 },
	{ w: 250, at: 214 },
	{ w: 280, at: 232 },
] as const;

/** The roadmap work the deliverable is linked to. */
const LINKS = [
	{ label: "Feature", at: 96 },
	{ label: "Task", at: 110 },
	{ label: "Milestone", at: 124 },
] as const;

export const DeliverableEmptyStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const out = lerp(frame, [298, 314], [1, 0], EASE_OUT);
	const sheetIn = springIn(frame, fps, 8, 26);
	const panelIn = springIn(frame, fps, 78, 26);

	// The status chips take turns rather than crossfading: they are different
	// widths, so overlapping them ghosts one behind the other (the revoke chip
	// in McpStory learned this the hard way).
	const draft = lerp(frame, [166, 176], [1, 0], EASE_OUT);
	const inReview =
		lerp(frame, [176, 186], [0, 1], EASE_OUT) *
		lerp(frame, [250, 260], [1, 0], EASE_OUT);
	const approved = lerp(frame, [260, 272], [0, 1], EASE_OUT);

	// The submit press, and the reviewer arriving because of it.
	const submit =
		lerp(frame, [160, 172], [0, 1], EASE_OUT) *
		lerp(frame, [176, 190], [1, 0], EASE_OUT);
	const reviewerIn = springIn(frame, fps, 186, 24);
	const stamp = lerp(frame, [262, 286], [0, 1], EASE_OUT);

	return (
		<Stage palette={LIGHT_PALETTE}>
			<div style={{ opacity: out }}>
				{/* ---------- The deliverable ---------- */}
				<div style={{ opacity: sheetIn }}>
					<Card
						x={SHEET.x}
						y={SHEET.y}
						w={SHEET.w}
						h={SHEET.h}
						scale={0.95 + 0.05 * sheetIn}
					/>
					<Chip
						x={SHEET.x + 36}
						y={SHEET.y + 34}
						label="Deliverable"
						tone="outline"
					/>

					{/* Status, one chip at a time, in the words the pipeline uses. */}
					<div style={{ opacity: draft }}>
						<Chip
							x={SHEET.x + 470}
							y={SHEET.y + 34}
							label="In progress"
							tone="muted"
						/>
					</div>
					<div style={{ opacity: inReview }}>
						<Chip
							x={SHEET.x + 470}
							y={SHEET.y + 34}
							label="In review"
							tone="primary"
						/>
					</div>
					<div style={{ opacity: approved }}>
						<Chip
							x={SHEET.x + 470}
							y={SHEET.y + 34}
							label="Approved"
							tone="primary"
						/>
					</div>

					{/* Title and summary, written in beat 1. */}
					<Bar
						x={SHEET.x + 36}
						y={SHEET.y + 118}
						w={430}
						h={18}
						tone="ink"
						opacity={0.85}
						reveal={lerp(frame, [22, 46], [0, 1], EASE_OUT)}
					/>
					<Bar
						x={SHEET.x + 36}
						y={SHEET.y + 158}
						w={560}
						h={11}
						reveal={lerp(frame, [34, 58], [0, 1], EASE_OUT)}
					/>
					<Bar
						x={SHEET.x + 36}
						y={SHEET.y + 186}
						w={470}
						h={11}
						reveal={lerp(frame, [42, 66], [0, 1], EASE_OUT)}
					/>

					{/* Acceptance criteria — the rows a reviewer actually ticks. */}
					{CRITERIA.map((criterion, i) => {
						const rowIn = springIn(frame, fps, 60 + i * 8, 22);
						const y = SHEET.y + 240 + i * 78;
						const tick = lerp(
							frame,
							[criterion.at, criterion.at + 18],
							[0, 1],
							EASE_OUT,
						);
						return (
							<div key={`criterion-${criterion.at}`} style={{ opacity: rowIn }}>
								<Card
									x={SHEET.x + 36}
									y={y}
									w={SHEET.w - 72}
									h={64}
									radius={14}
									tone="surfaceHi"
									scale={0.95 + 0.05 * rowIn}
								/>
								{/* The empty box shows through until the tick draws over it. */}
								<div
									style={{
										position: "absolute",
										left: SHEET.x + 62,
										top: y + 18,
										width: 28,
										height: 28,
										borderRadius: 8,
										border: `2px solid ${LIGHT_PALETTE.bar}`,
										opacity: 1 - tick,
									}}
								/>
								<CheckMark
									x={SHEET.x + 56}
									y={y + 12}
									size={40}
									progress={tick}
									tone="ok"
								/>
								<Bar x={SHEET.x + 112} y={y + 27} w={criterion.w} h={11} />
							</div>
						);
					})}

					{/* Submit for review — the press that starts beat 3. */}
					<Card
						x={SHEET.x + 36}
						y={SHEET.y + 484}
						w={280}
						h={60}
						radius={30}
						tone="primary"
						borderColor="transparent"
						scale={1 - 0.03 * submit}
						glow={submit * 0.8}
					/>
					<Bar
						x={SHEET.x + 82}
						y={SHEET.y + 509}
						w={188}
						h={12}
						tone="onPrimary"
						opacity={0.92}
					/>
				</div>

				{/* ---------- Linked roadmap work ---------- */}
				<div style={{ opacity: panelIn }}>
					<Card
						x={PANEL.x}
						y={PANEL.y}
						w={PANEL.w}
						h={PANEL.h}
						tone="surface"
						scale={0.95 + 0.05 * panelIn}
					/>
					<Chip
						x={PANEL.x + 32}
						y={PANEL.y + 34}
						label="Linked work"
						tone="muted"
					/>

					{LINKS.map((link, i) => {
						const rowIn = springIn(frame, fps, link.at, 22);
						const y = PANEL.y + 122 + i * 86;
						return (
							<div key={link.label} style={{ opacity: rowIn }}>
								<Card
									x={PANEL.x + 32}
									y={y}
									w={PANEL.w - 64}
									h={66}
									radius={14}
									tone="surfaceHi"
									scale={0.95 + 0.05 * rowIn}
								/>
								<Chip x={PANEL.x + 52} y={y + 11} label={link.label} />
								<Bar
									x={PANEL.x + 240}
									y={y + 29}
									w={190}
									h={10}
									reveal={lerp(
										frame,
										[link.at + 10, link.at + 30],
										[0, 1],
										EASE_OUT,
									)}
								/>
							</div>
						);
					})}

					{/* The reviewer, and the decision they made. */}
					<div style={{ opacity: reviewerIn }}>
						<Card
							x={PANEL.x + 32}
							y={PANEL.y + 400}
							w={PANEL.w - 64}
							h={140}
							radius={18}
							tone="surfaceHi"
							scale={0.95 + 0.05 * reviewerIn}
						/>
						<Avatar
							x={PANEL.x + 60}
							y={PANEL.y + 430}
							size={72}
							variant={2}
							ring={stamp}
						/>
						<Chip x={PANEL.x + 152} y={PANEL.y + 436} label="Reviewer" />
						<Bar
							x={PANEL.x + 152}
							y={PANEL.y + 498}
							w={220}
							h={10}
							reveal={lerp(frame, [200, 222], [0, 1], EASE_OUT)}
						/>
						<div style={{ opacity: stamp }}>
							<Badge x={PANEL.x + PANEL.w - 124} y={PANEL.y + 438} r={34}>
								<CheckMark
									x={10}
									y={10}
									size={48}
									progress={stamp}
									tone="primary"
								/>
							</Badge>
						</div>
					</div>
				</div>

				{/* The submission travelling from the sheet to the reviewer. */}
				<Connector
					d={`M ${SHEET.x + SHEET.w} ${SHEET.y + 514} C ${SHEET.x + SHEET.w + 90} ${SHEET.y + 514}, ${PANEL.x - 90} ${PANEL.y + 470}, ${PANEL.x} ${PANEL.y + 470}`}
					progress={lerp(frame, [172, 196], [0, 1], EASE_OUT)}
					tone="primary"
					width={3}
					opacity={lerp(frame, [278, 296], [1, 0], EASE_OUT)}
				/>
			</div>

			<CaptionTrack items={CAPTIONS} />
		</Stage>
	);
};

/** Rendered inside AbsoluteFill so the stage is exactly 1920x1080. */
export const DeliverableEmptyStage: React.FC = () => (
	<AbsoluteFill>
		<DeliverableEmptyStory />
	</AbsoluteFill>
);
