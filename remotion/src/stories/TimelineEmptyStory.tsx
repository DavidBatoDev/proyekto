import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_OUT, lerp, springIn } from "../anim";
import { FONT_BODY } from "../brand/fonts";
import { LIGHT_PALETTE, usePalette } from "../brand/palette";
import { CaptionTrack } from "../primitives/Caption";
import { Stage } from "../primitives/Stage";
import { Bar, Card, Chip, Connector } from "../primitives/shapes";

/**
 * The timeline empty-state clip: weeks → bars → dependencies → the date line.
 *
 * A timeline is a roadmap with dates on it, so the clip builds exactly that:
 * the same epic/feature rows the roadmap clip ends on, laid against a week
 * grid, wired by the dependency that makes one wait for another, and finally
 * crossed by the current-date marker that is the whole reason to look at it.
 *
 * LABEL DISCIPLINE: "Epic", "Feature", "Milestone" and "Today" only. The week
 * headers are ordinal (W1…W6), not invented calendar dates, which would date
 * the clip the moment it shipped.
 *
 * LIGHT palette: embedded inside the app shell. See McpStory's note.
 */

const CAPTIONS = [
	{ eyebrow: "Timeline", line: "The same plan, laid out in weeks" },
	{ eyebrow: "Schedule", line: "Give each epic a start and an end" },
	{ eyebrow: "Sequence", line: "Wire up what has to wait for what" },
	{ eyebrow: "Today", line: "See what's late before it's a surprise" },
] as const;

/** The grid: six week columns starting after the row-label gutter. */
const GRID_X = 520;
const GRID_W = 1240;
const WEEKS = 6;
const COL_W = GRID_W / WEEKS;
const ROW_Y = 300;
const ROW_H = 96;
const BAR_H = 42;

/**
 * The scheduled rows. `from`/`span` are in week columns; `at` is the frame the
 * bar starts growing.
 */
const ROWS = [
	{ label: "Epic", kind: "primary", from: 0, span: 2.5, at: 92 },
	{ label: "Feature", kind: "muted", from: 1.6, span: 2.2, at: 106 },
	{ label: "Feature", kind: "muted", from: 3.2, span: 2.0, at: 120 },
	{ label: "Milestone", kind: "primary", from: 5.0, span: 1.0, at: 134 },
] as const;

/** Finish-to-start links, drawn in beat 3: row i's end feeds row j's start. */
const LINKS = [
	{ from: 0, to: 1, at: 172 },
	{ from: 1, to: 2, at: 188 },
	{ from: 2, to: 3, at: 204 },
] as const;

const weekX = (week: number) => GRID_X + week * COL_W;
const rowY = (row: number) => ROW_Y + row * ROW_H;

export const TimelineEmptyStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const out = lerp(frame, [298, 314], [1, 0], EASE_OUT);
	const gridIn = springIn(frame, fps, 8, 26);

	// The marker sweeps across beat 4 and stops where "now" would be. It never
	// returns — the teardown fades it, so the seam stays clean.
	const marker = lerp(frame, [250, 292], [0, 1], EASE_OUT);
	const markerX = lerp(marker, [0, 1], [GRID_X, weekX(3.4)]);

	return (
		<Stage palette={LIGHT_PALETTE}>
			<div style={{ opacity: out }}>
				{/* ---------- The week grid ---------- */}
				<div style={{ opacity: gridIn }}>
					<Card
						x={GRID_X - 300}
						y={ROW_Y - 130}
						w={GRID_W + 320}
						h={ROW_H * ROWS.length + 180}
						radius={24}
						tone="surface"
						scale={0.97 + 0.03 * gridIn}
					/>
					{Array.from({ length: WEEKS }, (_unused, i) => i).map((week) => (
						<WeekColumn
							key={`w${week}`}
							x={weekX(week)}
							label={`W${week + 1}`}
							height={ROW_H * ROWS.length + 20}
							reveal={lerp(frame, [12 + week * 5, 34 + week * 5], [0, 1], EASE_OUT)}
						/>
					))}
				</div>

				{/* ---------- Dependency wires, under the bars ---------- */}
				{LINKS.map((link) => {
					const a = ROWS[link.from];
					const b = ROWS[link.to];
					const x1 = weekX(a.from + a.span);
					const y1 = rowY(link.from) + BAR_H / 2;
					const x2 = weekX(b.from);
					const y2 = rowY(link.to) + BAR_H / 2;
					// Out, down, in — the elbow every Gantt draws.
					const d = `M ${x1} ${y1} L ${x1 + 26} ${y1} L ${x1 + 26} ${y2} L ${x2} ${y2}`;
					return (
						<Connector
							key={`link-${link.from}-${link.to}`}
							d={d}
							progress={lerp(frame, [link.at, link.at + 22], [0, 1], EASE_OUT)}
							tone="muted"
							width={2}
						/>
					);
				})}

				{/* ---------- The scheduled bars ---------- */}
				{ROWS.map((row, i) => {
					const labelIn = springIn(frame, fps, 40 + i * 8, 22);
					const grow = lerp(frame, [row.at, row.at + 26], [0, 1], EASE_OUT);
					const y = rowY(i);
					return (
						<div key={`row-${row.label}-${row.from}`}>
							<div style={{ opacity: labelIn }}>
								<Chip x={GRID_X - 272} y={y - 1} label={row.label} tone={row.kind === "primary" ? "primary" : "muted"} />
							</div>
							{/* The lane the bar will fill, so a row is never empty air. */}
							<Bar
								x={GRID_X}
								y={y + BAR_H / 2 - 3}
								w={GRID_W}
								h={6}
								opacity={0.35 * labelIn}
							/>
							<div style={{ opacity: grow > 0 ? 1 : 0 }}>
								<Card
									x={weekX(row.from)}
									y={y}
									w={Math.max(1, COL_W * row.span * grow)}
									h={BAR_H}
									radius={BAR_H / 2}
									tone={row.kind === "primary" ? "primary" : "surfaceHi"}
									borderColor={row.kind === "primary" ? "transparent" : undefined}
								/>
							</div>
						</div>
					);
				})}

				{/* ---------- Today ---------- */}
				<TodayMarker
					x={markerX}
					top={ROW_Y - 92}
					height={ROW_H * ROWS.length + 60}
					opacity={lerp(frame, [248, 262], [0, 1], EASE_OUT)}
				/>
			</div>

			<CaptionTrack items={CAPTIONS} />
		</Stage>
	);
};

/** A week gridline with its header, wiping downward as the grid builds. */
const WeekColumn: React.FC<{
	x: number;
	label: string;
	height: number;
	reveal: number;
}> = ({ x, label, height, reveal }) => {
	const PALETTE = usePalette();
	return (
		<>
			<div
				style={{
					position: "absolute",
					left: x,
					top: ROW_Y - 40,
					width: 1,
					height: height * reveal,
					backgroundColor: PALETTE.hairline,
				}}
			/>
			<div
				style={{
					position: "absolute",
					left: x + 14,
					top: ROW_Y - 86,
					fontFamily: FONT_BODY,
					fontSize: 22,
					fontWeight: 700,
					letterSpacing: "0.12em",
					color: PALETTE.inkMuted,
					opacity: reveal,
				}}
			>
				{label}
			</div>
		</>
	);
};

/** The current-date line: the one element on a timeline that is not a plan. */
const TodayMarker: React.FC<{
	x: number;
	top: number;
	height: number;
	opacity: number;
}> = ({ x, top, height, opacity }) => {
	const PALETTE = usePalette();
	return (
		<div style={{ opacity }}>
			<div
				style={{
					position: "absolute",
					left: x,
					top,
					width: 3,
					height,
					borderRadius: 2,
					backgroundColor: PALETTE.blue600,
				}}
			/>
			<div
				style={{
					position: "absolute",
					left: x - 46,
					top: top - 44,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: 95,
					height: 40,
					borderRadius: 12,
					backgroundColor: PALETTE.blue600,
					fontFamily: FONT_BODY,
					fontSize: 21,
					fontWeight: 700,
					color: "#ffffff",
				}}
			>
				Today
			</div>
		</div>
	);
};

/** Rendered inside AbsoluteFill so the stage is exactly 1920x1080. */
export const TimelineEmptyStage: React.FC = () => (
	<AbsoluteFill>
		<TimelineEmptyStory />
	</AbsoluteFill>
);
