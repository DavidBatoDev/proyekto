import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_OUT, lerp, springIn } from "../anim";
import { LIGHT_PALETTE } from "../brand/palette";
import { CaptionTrack } from "../primitives/Caption";
import { Stage } from "../primitives/Stage";
import { Avatar, Bar, Card, Chip, Connector } from "../primitives/shapes";

/**
 * The roadmap empty-state clip: canvas → milestone → epics → features & owners.
 *
 * It shows the one thing the empty page cannot: what a roadmap *becomes*. The
 * canvas draws itself in the order the product builds it — a milestone, the
 * epics under it, then the features and the people who own them — because that
 * is the hierarchy `schemas/roadmap-ai-operations.json` actually encodes
 * (milestone → epic → feature → task).
 *
 * LIGHT, like McpStory and for the same reason: this sits inside the app shell
 * beside body copy, where a navy slab reads as a foreign object. See the note
 * in brand/palette.ts — the embed's border is what draws its edge.
 *
 * LABEL DISCIPLINE: only product vocabulary. "Milestone", "Epic", "Feature",
 * "Task" are the four node kinds the canvas has; nothing here invents a status
 * or a count the app would not show.
 *
 * Every element reads the GLOBAL frame; only the captions sit in a <Sequence>.
 */

const CAPTIONS = [
	{ eyebrow: "Start", line: "One canvas for the whole plan" },
	{ eyebrow: "Shape", line: "Milestones, then the epics under them" },
	{ eyebrow: "Detail", line: "Features and tasks hang off each epic" },
	{ eyebrow: "Own it", line: "Assign the work and it flows everywhere" },
] as const;

/** The milestone sits centred at the top; the epics fan out beneath it. */
const MILESTONE = { x: 760, y: 210, w: 400, h: 96 } as const;

const EPICS = [
	{ x: 300, label: "Epic", at: 84 },
	{ x: 760, label: "Epic", at: 96 },
	{ x: 1220, label: "Epic", at: 108 },
] as const;
const EPIC_Y = 400;
const EPIC_W = 400;
const EPIC_H = 96;

/** Features drop under the middle epic — one column, so the eye has one place to look. */
const FEATURES = [
	{ label: "Feature", at: 168 },
	{ label: "Feature", at: 182 },
	{ label: "Task", at: 196 },
] as const;
const FEATURE_Y = 570;
const FEATURE_H = 68;

export const RoadmapEmptyStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// Torn down before the loop point, so first and last frames match.
	const out = lerp(frame, [298, 314], [1, 0], EASE_OUT);

	const milestoneIn = springIn(frame, fps, 10, 26);

	return (
		<Stage palette={LIGHT_PALETTE}>
			<div style={{ opacity: out }}>
				{/* ---------- Milestone ---------- */}
				<div style={{ opacity: milestoneIn }}>
					<Card
						x={MILESTONE.x}
						y={MILESTONE.y}
						w={MILESTONE.w}
						h={MILESTONE.h}
						tone="surfaceHi"
						scale={0.94 + 0.06 * milestoneIn}
					/>
					<Chip
						x={MILESTONE.x + 24}
						y={MILESTONE.y + 26}
						label="Milestone"
						tone="primary"
					/>
					<Bar
						x={MILESTONE.x + 190}
						y={MILESTONE.y + 42}
						w={180}
						h={12}
						reveal={lerp(frame, [22, 44], [0, 1], EASE_OUT)}
					/>
				</div>

				{/* ---------- Epics ---------- */}
				{EPICS.map((epic, i) => {
					const cardIn = springIn(frame, fps, epic.at, 24);
					const wire = lerp(
						frame,
						[epic.at - 8, epic.at + 16],
						[0, 1],
						EASE_OUT,
					);
					const midX = epic.x + EPIC_W / 2;
					const d = `M ${MILESTONE.x + MILESTONE.w / 2} ${MILESTONE.y + MILESTONE.h} C ${MILESTONE.x + MILESTONE.w / 2} ${EPIC_Y - 40}, ${midX} ${MILESTONE.y + MILESTONE.h + 40}, ${midX} ${EPIC_Y}`;
					return (
						<div key={`epic-${epic.x}`}>
							<Connector d={d} progress={wire} tone="primary" width={3} />
							<div style={{ opacity: cardIn }}>
								<Card
									x={epic.x}
									y={EPIC_Y}
									w={EPIC_W}
									h={EPIC_H}
									scale={0.94 + 0.06 * cardIn}
								/>
								<Chip x={epic.x + 24} y={EPIC_Y + 26} label={epic.label} />
								<Bar
									x={epic.x + 140}
									y={EPIC_Y + 42}
									w={220}
									h={11}
									reveal={lerp(
										frame,
										[epic.at + 12, epic.at + 34],
										[0, 1],
										EASE_OUT,
									)}
								/>
								{/* A progress hairline, filling only on the epic that gets
								    the features — the other two have nothing under them yet. */}
								{i === 1 ? (
									<Bar
										x={epic.x + 24}
										y={EPIC_Y + EPIC_H - 16}
										w={352}
										h={6}
										tone="primary"
										reveal={lerp(frame, [200, 260], [0, 0.62], EASE_OUT)}
									/>
								) : null}
							</div>
						</div>
					);
				})}

				{/* ---------- Features under the middle epic ---------- */}
				{FEATURES.map((feature, i) => {
					const rowIn = springIn(frame, fps, feature.at, 22);
					const y = FEATURE_Y + i * 88;
					const x = 780;
					const w = 360;
					const spineX = 700;
					// One spine down the left, with a short elbow into each row.
					const d = `M ${spineX} ${EPIC_Y + EPIC_H} L ${spineX} ${y + FEATURE_H / 2} L ${x} ${y + FEATURE_H / 2}`;
					return (
						<div key={`feature-${feature.at}`}>
							<Connector
								d={d}
								progress={lerp(
									frame,
									[feature.at - 10, feature.at + 12],
									[0, 1],
									EASE_OUT,
								)}
								tone="muted"
								width={2}
							/>
							<div style={{ opacity: rowIn }}>
								<Card
									x={x}
									y={y}
									w={w}
									h={FEATURE_H}
									radius={14}
									tone="surfaceHi"
									scale={0.94 + 0.06 * rowIn}
								/>
								<Chip x={x + 18} y={y + 12} label={feature.label} />
								<Bar
									x={x + 150}
									y={y + 30}
									w={180}
									h={10}
									reveal={lerp(
										frame,
										[feature.at + 10, feature.at + 30],
										[0, 1],
										EASE_OUT,
									)}
								/>
							</div>
						</div>
					);
				})}

				{/* ---------- Owners docking onto the rows ---------- */}
				{[0, 1, 2].map((i) => {
					const at = 250 + i * 12;
					const dock = lerp(frame, [at, at + 22], [0, 1], EASE_OUT);
					const y = FEATURE_Y + i * 88 + 6;
					return (
						<Avatar
							key={`owner-${i}`}
							// Slides in from the right of the row and settles on it.
							x={lerp(dock, [0, 1], [1260, 1170])}
							y={y}
							size={56}
							variant={(i % 3) as 0 | 1 | 2}
							opacity={dock}
							scale={0.8 + 0.2 * dock}
						/>
					);
				})}
			</div>

			<CaptionTrack items={CAPTIONS} />
		</Stage>
	);
};

/** Rendered inside AbsoluteFill so the stage is exactly 1920x1080. */
export const RoadmapEmptyStage: React.FC = () => (
	<AbsoluteFill>
		<RoadmapEmptyStory />
	</AbsoluteFill>
);
