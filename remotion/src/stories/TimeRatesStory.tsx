import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_IN_OUT, EASE_OUT, lerp, springIn } from "../anim";
import { LIGHT_PALETTE } from "../brand/palette";
import { CaptionTrack } from "../primitives/Caption";
import { Stage } from "../primitives/Stage";
import { Avatar, Bar, Card, CheckMark, Chip } from "../primitives/shapes";

/**
 * The time clip for the product page: log it -> submit -> approved -> payout.
 *
 * One entry is followed door to door, the way BoardEmptyStory follows one card:
 * a timer runs against a task, the row settles into My Logs as Pending, a
 * reviewer docks and it flips to Approved, and the approved rows then collapse
 * into a Payout. Four beats, one object — four separate screens of a time
 * module would show the features and hide the pipeline, and the pipeline is the
 * only thing this section is actually claiming.
 *
 * ONE CENTRED COLUMN, ONE SHEET. Everything shares a centre line at x=960: the
 * entry, the list, and the payout the list becomes. So nothing on this stage
 * ever travels sideways, and there is only ever ONE card — the payout is not a
 * second panel fading in beside the list, it is the same sheet with its rows
 * resolved into lines and a total. A payout IS the list, priced; a panel
 * sliding in from the right would say it had been somewhere else all along, and
 * would leave half the frame empty for two beats to make room for itself.
 *
 * The sheet's geometry never changes, which is not laziness: a card that shrank
 * around the rows while the rows were still shrinking into it has to win that
 * race every frame, and it does not — the rows hang over its edges in the
 * middle of the move. The gather is carried by the rows alone.
 *
 * NO AMOUNTS, ANYWHERE. Every value on screen is a bar: the duration, the four
 * payout lines, the total. A rendered figure would be read as a promise about
 * what someone earns, and the arithmetic is not the point — the point is that
 * time becomes an approved, rated record without anyone re-typing it. The one
 * nod to rates is the "Rate card" chip on the payout header, which is what
 * turns the left column of that card into the right one.
 *
 * LABEL DISCIPLINE: every word on screen is a shipped label. "My Logs",
 * "Timer", "Pending", "Approved", "Payout" and "Rate card" are the team-time
 * UI's own vocabulary, and "Task" is the node kind time is logged against. Note
 * "Pending" rather than "Submitted": submitting is the move, but `pending` is
 * the status the product actually writes, and a chip saying something the app
 * never says is the detail that makes a mock look fake. There is no submit
 * BUTTON for the same reason — it would need a label the caption already
 * carries, and the settle into the list is the submit.
 *
 * Three staging decisions worth the pixels:
 *  - The entry lands in the TOP slot. A logs list is newest-first, and it also
 *    keeps the trip clear of the rows fading in beneath it: the hero pose and
 *    slot 1 never overlap at a frame where either is visible.
 *  - The three rows already in the list are dimmed AND already ticked. Being
 *    the only un-ticked row is what makes beat 3 land, and it is what makes
 *    beat 4 honest — a payout groups approved time, so approved neighbours have
 *    to exist before anything can be grouped with them.
 *  - The gather FADES each row out mid-flight instead of shrinking it into the
 *    card. A row scaled down far enough to stack four deep inside the payout
 *    renders its 22px chips at ~7px on the embedded page, which is not small
 *    text, it is noise. The card draws its own line per arrival instead.
 *
 * Every element reads the GLOBAL frame; only the captions sit in a <Sequence>,
 * because inside one `useCurrentFrame()` is beat-local and the cross-beat trip
 * this whole clip is built on needs the global clock.
 *
 * LIGHT palette: this sits on the product page beside the other light clips,
 * where a navy slab reads as a foreign object. See the note on McpStory.
 */

const CAPTIONS = [
	{ eyebrow: "Log", line: "Time, logged against the task" },
	{ eyebrow: "Submit", line: "Send it for approval" },
	{ eyebrow: "Approve", line: "A reviewer signs it off" },
	{ eyebrow: "Payout", line: "Approved time, grouped into one" },
] as const;

/**
 * The sheet: My Logs in beats 2-3, the Payout in beat 4. It stops well above
 * y=812, where the caption eyebrow is printed (Caption.tsx) — a taller list
 * would put its last row under the word.
 */
const SHEET = { x: 535, y: 196, w: 850, h: 556 } as const;

const ROW = { x: 565, w: 790, h: 88 } as const;
/** The four list slots, top to bottom. Slot 0 is where the new entry lands. */
const SLOT_Y = [314, 420, 526, 632] as const;
/** The payout's four lines, in list order — the same slots, pulled together. */
const ITEM_Y = [330, 402, 474, 546] as const;

/** Beat 1 holds the entry here: on the centre line, oversized, and alone. */
const HERO = { y: 430, scale: 1.3 } as const;

/**
 * The rows already in My Logs, in slots 1-3. `name` and `value` are bar widths
 * and nothing else — see the no-amounts note above. `dur` is how full each
 * duration track sits, varied so the list does not read as one row cloned.
 */
const PRIOR = [
	{ slot: 1, at: 110, name: 176, dur: 0.4, value: 74 },
	{ slot: 2, at: 118, name: 138, dur: 0.78, value: 146 },
	{ slot: 3, at: 126, name: 150, dur: 0.62, value: 118 },
] as const;

/** The followed entry's own widths, in the same currency-free units. */
const TRACKED = { name: 164, dur: 0.88, value: 128 } as const;

/** The gather: slot 0 resolves first, each next one five frames behind it. */
const GATHER_AT = 250;
const GATHER_STEP = 5;
const GATHER_LEN = 24;

/** Where a row sits, and how solid it is, at this frame. */
type Pose = { dy: number; scale: number; opacity: number };

/**
 * A row's offset from its natural slot. Vertical only — the column is centred,
 * so a row's centre line is its slot's, its hero pose's, and its payout line's
 * all at once, and nothing here ever needs to travel sideways.
 *
 * Two legs, and they never run at once: the tracked row's trip in from the hero
 * pose is long finished before the gather starts, so chaining the second lerp
 * onto the first's result is safe and costs no state.
 */
function poseFor(slot: number, frame: number, hero: boolean): Pose {
	const cy = SLOT_Y[slot] + ROW.h / 2;

	let dy = 0;
	let scale = 1;

	if (hero) {
		const land = lerp(frame, [92, 128], [0, 1], EASE_IN_OUT);
		dy = lerp(land, [0, 1], [HERO.y - cy, 0]);
		scale = lerp(land, [0, 1], [HERO.scale, 1]);
		// Picked up and put down. The arc is what makes it read as a move rather
		// than as a card being retyped somewhere else.
		dy -= Math.sin(Math.PI * land) * 28;
	}

	const at = GATHER_AT + slot * GATHER_STEP;
	const gather = lerp(frame, [at, at + GATHER_LEN], [0, 1], EASE_IN_OUT);
	dy = lerp(gather, [0, 1], [dy, ITEM_Y[slot] + 20 - cy]);
	scale = lerp(gather, [0, 1], [scale, 0.7]);

	return { dy, scale, opacity: lerp(gather, [0.4, 0.92], [1, 0]) };
}

export const TimeRatesStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// The scene is torn down before the loop point, so frame 329 and frame 0 are
	// the same empty ground and the cut between them is invisible.
	const out = lerp(frame, [298, 314], [1, 0], EASE_OUT);

	const entryIn = springIn(frame, fps, 6, 26);
	const sheetIn = springIn(frame, fps, 100, 26);

	// Beat 1: the timer runs and the duration fills. The dot is the only thing
	// in this clip that pulses ambiently; its 30-frame period divides 330, so it
	// is in the same phase at both ends of the loop.
	const timerPulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin((frame / 15) * Math.PI));

	// One status slot, three states, taking turns. They never crossfade: the
	// three labels are three different widths, so overlapping them ghosts one
	// behind the other (McpStory's revoke chip learned this the hard way). The
	// header chip does the same when My Logs becomes Payout.
	const timer =
		lerp(frame, [20, 34], [0, 1], EASE_OUT) *
		lerp(frame, [84, 92], [1, 0], EASE_OUT);
	const pending =
		lerp(frame, [130, 142], [0, 1], EASE_OUT) *
		lerp(frame, [198, 208], [1, 0], EASE_OUT);
	const approved = lerp(frame, [208, 220], [0, 1], EASE_OUT);

	// Beat 3 is one event: the reviewer arrives and the row flips. Nothing else
	// moves while it happens.
	const reviewer = springIn(frame, fps, 180, 26);
	const reviewerSlide = lerp(frame, [180, 208], [72, 0], EASE_OUT);
	const stamp = lerp(frame, [208, 232], [0, 1], EASE_OUT);
	const tick = lerp(frame, [210, 234], [0, 1], EASE_OUT);

	// Beat 4.
	const listChip = lerp(frame, [242, 252], [1, 0], EASE_OUT);
	const payoutChip = lerp(frame, [254, 266], [0, 1], EASE_OUT);
	// The rate card is what turns the left column of the payout into the right
	// one, so it lands with the first line rather than with the header.
	const rateIn = springIn(frame, fps, 264, 22);
	const summary = lerp(frame, [266, 282], [0, 1], EASE_OUT);
	const total = lerp(frame, [270, 294], [0, 1], EASE_OUT);

	return (
		<Stage palette={LIGHT_PALETTE}>
			<div style={{ opacity: out }}>
				{/* ---------- The sheet: My Logs, resolving into the Payout ----------
				    Drawn BEFORE the rows, so a row gathering into it passes OVER the
				    card and dissolves onto its line rather than under its edge. */}
				<div style={{ opacity: sheetIn }}>
					<Card
						x={SHEET.x}
						y={SHEET.y}
						w={SHEET.w}
						h={SHEET.h}
						tone="surface"
						scale={0.96 + 0.04 * sheetIn}
					/>
					<div style={{ opacity: listChip }}>
						<Chip
							x={SHEET.x + 36}
							y={SHEET.y + 34}
							label="My Logs"
							tone="outline"
						/>
					</div>
					<div style={{ opacity: payoutChip }}>
						<Chip
							x={SHEET.x + 36}
							y={SHEET.y + 34}
							label="Payout"
							tone="primary"
						/>
					</div>
					<div style={{ opacity: rateIn }}>
						<Chip
							x={SHEET.x + SHEET.w - 204}
							y={SHEET.y + 34}
							label="Rate card"
							tone="outline"
						/>
					</div>

					{/* One line per arrival, drawn as the row that fed it fades out. */}
					<PayoutLine
						index={0}
						frame={frame}
						nameW={TRACKED.name}
						valueW={TRACKED.value}
					/>
					{PRIOR.map((prior) => (
						<PayoutLine
							key={`line-${prior.slot}`}
							index={prior.slot}
							frame={frame}
							nameW={prior.name}
							valueW={prior.value}
						/>
					))}

					{/* The total: same right edge as the four lines above it, and wider
					    than any of them. Never a figure — see the note up top. */}
					<div style={{ opacity: summary }}>
						<Bar x={SHEET.x + 40} y={632} w={770} h={2} opacity={0.9} />
						<Bar x={SHEET.x + 40} y={666} w={120} h={12} reveal={total} />
						<Bar
							x={SHEET.x + 436}
							y={660}
							w={374}
							h={24}
							tone="primary"
							reveal={total}
						/>
					</div>
				</div>

				{/* ---------- The entries already logged ---------- */}
				{PRIOR.map((prior) => {
					const rowIn = springIn(frame, fps, prior.at, 22);
					return (
						<LogRow
							key={`prior-${prior.slot}`}
							y={SLOT_Y[prior.slot]}
							pose={poseFor(prior.slot, frame, false)}
							// Dimmed: they are context for the one row that moves.
							opacity={rowIn * 0.62}
							nameW={prior.name}
							dur={prior.dur}
							approved={1}
							tick={1}
						/>
					);
				})}

				{/* ---------- The entry this clip follows ---------- */}
				<LogRow
					y={SLOT_Y[0]}
					pose={poseFor(0, frame, true)}
					opacity={entryIn}
					nameW={TRACKED.name}
					dur={TRACKED.dur}
					// Lit only while the timer runs: in beat 1 this row is alone on
					// the ground with nothing to sit against, and a running entry is
					// the one thing on this stage that is genuinely live.
					glow={timer * 0.45}
					// The fill wipes left to right across beat 1, which is as close as
					// a flat bar gets to a timer counting up.
					durReveal={lerp(frame, [26, 86], [0, 1])}
					nameReveal={lerp(frame, [18, 44], [0, 1], EASE_OUT)}
					timer={timer}
					timerPulse={timerPulse}
					pending={pending}
					approved={approved}
					tick={tick}
					reviewer={reviewer}
					reviewerSlide={reviewerSlide}
					ring={stamp}
				/>
			</div>

			<CaptionTrack items={CAPTIONS} />
		</Stage>
	);
};

/**
 * One row of My Logs: the task it is against, what it is called, how long it
 * ran, a mark, and a status.
 *
 * The transform lives on a wrapper rather than on each primitive because the
 * row's parts are absolute SIBLINGS, not children — scaling the Card alone
 * would leave its chips and bars behind. `transformOrigin` is given in stage
 * pixels: the wrapper is a zero-height box pinned at the stage origin, so px
 * there mean exactly what they mean everywhere else in this file.
 */
const LogRow: React.FC<{
	y: number;
	pose: Pose;
	opacity: number;
	nameW: number;
	dur: number;
	glow?: number;
	durReveal?: number;
	nameReveal?: number;
	timer?: number;
	timerPulse?: number;
	pending?: number;
	approved?: number;
	tick?: number;
	reviewer?: number;
	reviewerSlide?: number;
	ring?: number;
}> = ({
	y,
	pose,
	opacity,
	nameW,
	dur,
	glow = 0,
	durReveal = 1,
	nameReveal = 1,
	timer = 0,
	timerPulse = 1,
	pending = 0,
	approved = 0,
	tick = 0,
	reviewer = 0,
	reviewerSlide = 0,
	ring = 0,
}) => {
	const x = ROW.x;
	return (
		<div
			style={{
				opacity: opacity * pose.opacity,
				transform: `translateY(${pose.dy}px) scale(${pose.scale})`,
				transformOrigin: `${x + ROW.w / 2}px ${y + ROW.h / 2}px`,
			}}
		>
			<Card
				x={x}
				y={y}
				w={ROW.w}
				h={ROW.h}
				radius={18}
				tone="surfaceHi"
				glow={glow}
			/>
			<Chip x={x + 24} y={y + 22} label="Task" />
			<Bar x={x + 148} y={y + 39} w={nameW} h={12} reveal={nameReveal} />

			{/* Duration: a track and a fill, so a part-filled bar still reads as a
			    length of time rather than as a progress bar stuck at 40%. */}
			<Bar x={x + 348} y={y + 37} w={140} h={14} opacity={0.55} />
			<Bar
				x={x + 348}
				y={y + 37}
				w={140 * dur}
				h={14}
				tone="primary"
				reveal={durReveal}
			/>

			{/* The mark slot: the timer's pulse while it runs, the approval tick
			    afterwards. One slot, so the tick lands where the eye already is. */}
			<div style={{ opacity: timer }}>
				<Bar
					x={x + 513}
					y={y + 37}
					w={14}
					h={14}
					tone="primary"
					opacity={timerPulse}
				/>
			</div>
			<CheckMark x={x + 500} y={y + 24} size={40} progress={tick} tone="ok" />

			{/* The status slot. "Pending" is an OUTLINE chip, not a muted one: on
			    this palette `chipMuted` and `surfaceHi` are the same grey, so a
			    muted pill on a row is a label floating with no pill at all. */}
			<div style={{ opacity: timer }}>
				<Chip x={x + 552} y={y + 22} label="Timer" tone="primary" />
			</div>
			<div style={{ opacity: pending }}>
				<Chip x={x + 552} y={y + 22} label="Pending" tone="outline" />
			</div>
			<div style={{ opacity: approved }}>
				<Chip x={x + 552} y={y + 22} label="Approved" tone="primary" />
			</div>

			{/* Who approved it, docking in from the row's right edge. */}
			<Avatar
				x={x + 716 + reviewerSlide}
				y={y + 16}
				size={56}
				variant={2}
				ring={ring}
				opacity={reviewer}
				scale={0.6 + 0.4 * reviewer}
			/>
		</div>
	);
};

/**
 * A payout line: what came in, and what it is worth once the rate card has been
 * applied. Both are bars, and the value is right-aligned so four of them stack
 * into a column the total can sit under and out-reach.
 */
const PayoutLine: React.FC<{
	index: number;
	frame: number;
	nameW: number;
	valueW: number;
}> = ({ index, frame, nameW, valueW }) => {
	// Lands as the row feeding it fades, which is what ties the two halves of
	// beat 4 together instead of leaving them as two things happening at once.
	const at = GATHER_AT + index * GATHER_STEP + 14;
	const arrive = lerp(frame, [at, at + 14], [0, 1], EASE_OUT);
	const y = ITEM_Y[index];
	return (
		<div style={{ opacity: arrive }}>
			<Bar x={SHEET.x + 40} y={y + 14} w={nameW} h={12} reveal={arrive} />
			<Bar
				x={SHEET.x + 810 - valueW}
				y={y + 12}
				w={valueW}
				h={16}
				tone="primary"
				opacity={0.85}
				reveal={arrive}
			/>
		</div>
	);
};

/** Rendered inside AbsoluteFill so the stage is exactly 1920x1080. */
export const TimeRatesStage: React.FC = () => (
	<AbsoluteFill>
		<TimeRatesStory />
	</AbsoluteFill>
);
