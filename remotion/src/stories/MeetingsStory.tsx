import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_OUT, lerp, springIn } from "../anim";
import { FONT_BODY } from "../brand/fonts";
import { LIGHT_PALETTE, usePalette } from "../brand/palette";
import { CaptionTrack } from "../primitives/Caption";
import { Stage } from "../primitives/Stage";
import { Avatar, Badge, Bar, Card, Chip } from "../primitives/shapes";

/**
 * The meetings clip: the week → pick a slot → it repeats → everyone's in.
 *
 * The section this sits beside claims a real calendar rather than a date field,
 * so the clip has to be one: a week grid with hour rules, weekday headers and
 * events already in it. An empty grid would be the thing we are arguing against
 * — three dimmed events sit in Mon/Tue/Thu from the first beat so the week
 * reads as someone's actual week, and the new block lands into company.
 *
 * The picked slot is on FRIDAY, the last column, on purpose. Beat 3 has to say
 * "this is now a series", and the only honest direction for the following weeks
 * is rightward, off the end of this one. From any middle column the echoes
 * would have to cross Thursday and Friday, where they would read as three more
 * meetings in the same week — the exact opposite of what a repeat rule means.
 * Past Friday's edge there is nothing to contradict, so the three echoes narrow
 * and fade as they go: further away in time, further away on screen.
 *
 * The editor is a popover beside the slot, not a modal over the calendar. It is
 * shaped like the shipped one (Google-Calendar idiom: a title you type, then a
 * timezone and a repeat rule as their own rows) and it CLOSES at the top of
 * beat 3, which is what frees the right-hand space the echoes then occupy. The
 * close is a `lerp` fade, never a spring — see the seed-pose note below.
 *
 * LABEL DISCIPLINE: every word on screen exists in the product. "Mon".."Fri"
 * and the hour labels are what `calendar/TimeGrid.tsx` renders; "Weekly" is a
 * `RepeatDropdown` preset; "Video link" is the video row's own vocabulary;
 * "Asia/Singapore" is a real entry in the IANA list the timezone picker uses —
 * a named zone rather than an offset, which is the point the docs make about
 * series. No dates and no day numbers: those would date the clip the moment it
 * shipped, the same reason TimelineEmptyStory counts weeks as W1…W6.
 *
 * The chips that sit ON the blue block are `tone="muted"` rather than primary —
 * a primary chip on a primary fill is invisible, and a light pill on a blue
 * event is what a real calendar draws anyway.
 *
 * Every element reads the GLOBAL frame and lives outside every <Sequence>; only
 * the captions are wrapped, because inside one `useCurrentFrame()` is
 * beat-local and the block's growth spans beats 2–4.
 *
 * THE LOOP: the seed pose is the bare ground. Every entrance is a `springIn`
 * from it, the whole scene fades through `out` over frames 298→314, and frame
 * 329 is therefore the same empty panel as frame 0. Anything returning to seed
 * (the editor closing, the pick ripple) uses `lerp` + `EASE_OUT`, which lands
 * exactly where a spring would leave a sub-pixel residue.
 *
 * LIGHT palette: this sits on the light product page beside three other light
 * clips, where a navy slab reads as a foreign object. See McpStory's note.
 */

const CAPTIONS = [
	{ eyebrow: "Calendar", line: "The week, hour by hour" },
	{ eyebrow: "Schedule", line: "Click a slot, fill it in" },
	{ eyebrow: "Repeat", line: "One rule makes it a series" },
	{ eyebrow: "Guests", line: "Video link out, everyone in" },
] as const;

/** The calendar panel, and the time gutter that eats its left edge. */
const CAL = { x: 140, y: 150, w: 1160, h: 610 } as const;
const GUTTER = 96;
const COL_X = CAL.x + GUTTER;
const COL_W = 208;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

/**
 * Five hour rules plus the closing line beneath them. Working hours only — a
 * 24-hour grid at this scale is a texture, not a calendar.
 */
const HOURS = ["9 AM", "10 AM", "11 AM", "12 PM", "1 PM"] as const;
const RULE_Y = 272;
const ROW_H = 92;

const colX = (col: number) => COL_X + col * COL_W;
const ruleY = (row: number) => RULE_Y + row * ROW_H;
/** Events inset inside their column, the way a calendar gutters its blocks. */
const EVENT_W = COL_W - 20;

/** The week that was already there. Dimmed, so the new block owns the eye. */
const EXISTING = [
	{ col: 0, y: 372, h: 84, at: 46 },
	{ col: 1, y: 556, h: 76, at: 56 },
	{ col: 3, y: 280, h: 88, at: 66 },
] as const;

/** The slot that gets picked: Friday, two rules down. */
const SLOT = { x: colX(4) + 10, y: 464, w: EVENT_W, h: 196 } as const;
/** The cell the click lands in, which the ripple traces. */
const CELL = { x: colX(4), y: ruleY(2), w: COL_W, h: ROW_H } as const;

/** The scheduler popover, in the space the echoes inherit in beat 3. */
const EDITOR = { x: 1370, y: 296, w: 410, h: 360 } as const;
const ROW_X = EDITOR.x + 24;
const ROW_W = EDITOR.w - 48;

/**
 * The following weeks. Same y and height as the block — a series is the same
 * slot every week — but narrowing and fading, which is the only cue available
 * for "further away" on a stage with no perspective.
 */
const ECHOES = [
	{ x: 1352, w: 148, alpha: 0.5, at: 190 },
	{ x: 1534, w: 124, alpha: 0.32, at: 204 },
	{ x: 1694, w: 102, alpha: 0.2, at: 218 },
] as const;

/** The three guests, docking in from the lower right. */
const GUESTS = [
	{ x: SLOT.x + 14, variant: 0, at: 258 },
	{ x: SLOT.x + 48, variant: 1, at: 266 },
	{ x: SLOT.x + 82, variant: 2, at: 274 },
] as const;

export const MeetingsStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const out = lerp(frame, [298, 314], [1, 0], EASE_OUT);
	const calIn = springIn(frame, fps, 6, 26);

	// The click: a ripple bounded at BOTH ends, so it is absent at frame 0. A
	// bare falling lerp would read as 1 before its window opens and park a ring
	// on the seed pose.
	const pick = Math.min(
		lerp(frame, [88, 94], [0, 1]),
		lerp(frame, [94, 118], [1, 0], EASE_OUT),
	);

	// The block draws DOWNWARD from the slot's top edge, which is the gesture a
	// person makes dragging out a time range.
	const draw = lerp(frame, [96, 124], [0, 1], EASE_OUT);
	const blockBody = lerp(frame, [124, 140], [0, 1], EASE_OUT);

	// The editor opens on the pick and closes into beat 3. Spring in, lerp out.
	const editor =
		springIn(frame, fps, 112, 24) * lerp(frame, [168, 184], [1, 0], EASE_OUT);
	const typing = lerp(frame, [126, 150], [0, 1], EASE_OUT);

	const series = springIn(frame, fps, 182, 22);
	const video = springIn(frame, fps, 248, 22);
	const reminder = springIn(frame, fps, 280, 20);

	return (
		<Stage palette={LIGHT_PALETTE}>
			<div style={{ opacity: out }}>
				{/* ---------- The week ---------- */}
				<div style={{ opacity: calIn }}>
					<Card
						x={CAL.x}
						y={CAL.y}
						w={CAL.w}
						h={CAL.h}
						radius={24}
						tone="surface"
						scale={0.97 + 0.03 * calIn}
					/>
					{DAYS.map((day, i) => (
						<DayHeading
							key={day}
							x={colX(i) + 14}
							label={day}
							opacity={springIn(frame, fps, 14 + i * 5, 22)}
						/>
					))}
					<HeaderRule reveal={lerp(frame, [16, 40], [0, 1], EASE_OUT)} />
					{HOURS.map((hour, i) => (
						<HourRule
							key={hour}
							y={ruleY(i)}
							label={hour}
							reveal={lerp(frame, [20 + i * 4, 44 + i * 4], [0, 1], EASE_OUT)}
						/>
					))}
					{/* The line that closes the last hour, label-less. */}
					<HourRule
						y={ruleY(HOURS.length)}
						reveal={lerp(frame, [40, 64], [0, 1], EASE_OUT)}
					/>
				</div>

				{/* ---------- What was already in the week ---------- */}
				{EXISTING.map((event) => {
					const eventIn = springIn(frame, fps, event.at, 22);
					const x = colX(event.col) + 10;
					return (
						<div
							key={`event-${event.col}-${event.y}`}
							style={{ opacity: eventIn * 0.62 }}
						>
							<Card
								x={x}
								y={event.y}
								w={EVENT_W}
								h={event.h}
								radius={12}
								tone="surfaceHi"
								scale={0.95 + 0.05 * eventIn}
							/>
							<Bar x={x + 18} y={event.y + 20} w={110} h={9} />
							<Bar x={x + 18} y={event.y + 40} w={72} h={8} opacity={0.8} />
						</div>
					);
				})}

				{/* ---------- The following weeks ---------- */}
				{ECHOES.map((echo) => {
					const echoIn = springIn(frame, fps, echo.at, 24);
					return (
						<div key={`echo-${echo.x}`} style={{ opacity: echoIn * echo.alpha }}>
							{/* A week needs an edge to belong to, or the echo is a block
							    floating in nothing. */}
							<div
								style={{
									position: "absolute",
									left: echo.x - 22,
									top: ruleY(0),
									width: 1,
									height: ruleY(HOURS.length) - ruleY(0),
									backgroundColor: LIGHT_PALETTE.bar,
									opacity: 0.6,
								}}
							/>
							<Card
								x={echo.x}
								y={SLOT.y}
								w={echo.w}
								h={SLOT.h}
								radius={12}
								tone="primary"
								borderColor="transparent"
								scale={0.94 + 0.06 * echoIn}
							/>
						</div>
					);
				})}

				{/* ---------- The slot being picked ---------- */}
				<PickRipple opacity={pick} />

				{/* The block itself: height is the animated value, top edge fixed. */}
				<div style={{ opacity: draw > 0 ? 1 : 0 }}>
					<Card
						x={SLOT.x}
						y={SLOT.y}
						w={SLOT.w}
						h={Math.max(1, SLOT.h * draw)}
						radius={12}
						tone="primary"
						borderColor="transparent"
						glow={0.4 * pick}
					/>
				</div>
				<div style={{ opacity: blockBody }}>
					<Bar
						x={SLOT.x + 18}
						y={SLOT.y + 22}
						w={118}
						h={11}
						tone="onPrimary"
						reveal={typing}
					/>
					<Bar
						x={SLOT.x + 18}
						y={SLOT.y + 46}
						w={76}
						h={9}
						tone="onPrimary"
						opacity={0.65}
					/>
				</div>

				{/* The series badge. It sits ABOVE the block rather than inside it:
				    the block is already carrying the video chip and three guests,
				    and up there it points the eye straight at the echoes. */}
				<div style={{ opacity: series }}>
					<Chip
						x={SLOT.x}
						y={408}
						label="Weekly"
						tone="muted"
						scale={0.88 + 0.12 * series}
					/>
				</div>

				{/* ---------- Video link, guests, reminder ---------- */}
				<div style={{ opacity: video }}>
					<Chip
						x={SLOT.x + 10}
						y={SLOT.y + 76}
						label="Video link"
						tone="muted"
						scale={0.9 + 0.1 * video}
					/>
				</div>
				{GUESTS.map((guest) => {
					const dock = springIn(frame, fps, guest.at, 22);
					return (
						<Avatar
							key={`guest-${guest.variant}`}
							// Drifts in from below and to the right, so they read as
							// arriving on the meeting rather than fading up out of it.
							x={guest.x + (1 - dock) * 34}
							y={SLOT.y + 134 + (1 - dock) * 18}
							size={42}
							variant={guest.variant}
							opacity={dock}
							scale={0.6 + 0.4 * dock}
						/>
					);
				})}
				<div style={{ opacity: reminder }}>
					<Badge
						x={SLOT.x + SLOT.w - 24}
						y={SLOT.y - 24}
						r={24}
						scale={0.8 + 0.2 * reminder}
					>
						<svg width={26} height={26} viewBox="0 0 24 24" fill="none">
							<title>reminder</title>
							<path
								d="M12 4.5a5 5 0 0 0-5 5v3.2L5.6 15.4h12.8L17 12.7V9.5a5 5 0 0 0-5-5z"
								stroke="#ffffff"
								strokeWidth={1.7}
								strokeLinejoin="round"
							/>
							<path
								d="M10.3 17.6a1.8 1.8 0 0 0 3.4 0"
								stroke="#ffffff"
								strokeWidth={1.7}
								strokeLinecap="round"
							/>
						</svg>
					</Badge>
				</div>

				{/* ---------- The scheduler ---------- */}
				<div style={{ opacity: editor }}>
					<Card
						x={EDITOR.x}
						y={EDITOR.y}
						w={EDITOR.w}
						h={EDITOR.h}
						radius={20}
						tone="surface"
						scale={0.94 + 0.06 * editor}
					/>
					<Chip x={ROW_X} y={EDITOR.y + 26} label="Meeting" tone="primary" />

					{/* Title: a bar being typed, not a placeholder that was always there. */}
					<Card
						x={ROW_X}
						y={376}
						w={ROW_W}
						h={60}
						radius={14}
						tone="surfaceHi"
					/>
					<Bar x={ROW_X + 24} y={400} w={250} h={12} reveal={typing} />

					<Card
						x={ROW_X}
						y={452}
						w={ROW_W}
						h={60}
						radius={14}
						tone="surfaceHi"
					/>
					<Chip x={ROW_X + 12} y={460} label="Asia/Singapore" tone="muted" />

					<Card
						x={ROW_X}
						y={528}
						w={ROW_W}
						h={60}
						radius={14}
						tone="surfaceHi"
					/>
					<Chip x={ROW_X + 12} y={536} label="Weekly" tone="muted" />

					{/* The commit gesture, glyph-only — a labelled button here would be
					    invented copy. */}
					<Badge
						x={EDITOR.x + EDITOR.w - 68}
						y={EDITOR.y + EDITOR.h - 56}
						r={22}
						scale={0.85 + 0.15 * springIn(frame, fps, 152, 20)}
					>
						<svg width={24} height={24} viewBox="0 0 24 24" fill="none">
							<title>save</title>
							<path
								d="M5 12.5l4.5 4.5L19 7"
								stroke="#ffffff"
								strokeWidth={2.2}
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</Badge>
				</div>
			</div>

			<CaptionTrack items={CAPTIONS} />
		</Stage>
	);
};

/** A weekday column header, in the same key as the board's column headers. */
const DayHeading: React.FC<{ x: number; label: string; opacity: number }> = ({
	x,
	label,
	opacity,
}) => {
	const PALETTE = usePalette();
	return (
		<div
			style={{
				position: "absolute",
				left: x,
				top: CAL.y + 34,
				fontFamily: FONT_BODY,
				fontSize: 24,
				fontWeight: 700,
				letterSpacing: "0.1em",
				textTransform: "uppercase",
				color: PALETTE.inkMuted,
				opacity,
			}}
		>
			{label}
		</div>
	);
};

/** The line under the weekday row, wiping across with the grid. */
const HeaderRule: React.FC<{ reveal: number }> = ({ reveal }) => {
	const PALETTE = usePalette();
	return (
		<div
			style={{
				position: "absolute",
				left: COL_X,
				top: CAL.y + 82,
				width: COL_W * DAYS.length * reveal,
				height: 1,
				backgroundColor: PALETTE.bar,
			}}
		/>
	);
};

/**
 * One hour rule and its label. The rule wipes left→right rather than fading,
 * the same idiom `Bar` uses, so the grid reads as being ruled rather than
 * dissolving in.
 */
const HourRule: React.FC<{ y: number; label?: string; reveal: number }> = ({
	y,
	label,
	reveal,
}) => {
	const PALETTE = usePalette();
	return (
		<>
			<div
				style={{
					position: "absolute",
					left: COL_X,
					top: y,
					width: COL_W * DAYS.length * reveal,
					height: 1,
					backgroundColor: PALETTE.hairline,
				}}
			/>
			{label ? (
				<div
					style={{
						position: "absolute",
						left: CAL.x + 20,
						top: y - 13,
						width: GUTTER - 36,
						textAlign: "right",
						fontFamily: FONT_BODY,
						fontSize: 20,
						fontWeight: 600,
						letterSpacing: "0.04em",
						color: PALETTE.inkMuted,
						opacity: reveal * 0.85,
					}}
				>
					{label}
				</div>
			) : null}
		</>
	);
};

/**
 * The ring a click leaves in the cell it lands in — the one beat of feedback
 * that makes the block that follows read as a consequence rather than an
 * arrival.
 */
const PickRipple: React.FC<{ opacity: number }> = ({ opacity }) => {
	const PALETTE = usePalette();
	return (
		<div
			style={{
				position: "absolute",
				left: CELL.x + 4,
				top: CELL.y + 4,
				width: CELL.w - 8,
				height: CELL.h - 8,
				borderRadius: 14,
				border: `2px solid ${PALETTE.blue400}`,
				backgroundColor: `rgba(${PALETTE.glowRgb},0.08)`,
				opacity: opacity * 0.85,
				transform: `scale(${1 + 0.08 * (1 - opacity)})`,
				transformOrigin: "center center",
			}}
		/>
	);
};

/** Rendered inside AbsoluteFill so the stage is exactly 1920x1080. */
export const MeetingsStage: React.FC = () => (
	<AbsoluteFill>
		<MeetingsStory />
	</AbsoluteFill>
);
