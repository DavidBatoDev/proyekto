import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { bezier, EASE_IN_OUT, EASE_OUT, lerp, springIn } from "../anim";
import { FONT_BODY } from "../brand/fonts";
import { LIGHT_PALETTE, usePalette } from "../brand/palette";
import { CaptionTrack } from "../primitives/Caption";
import { Stage } from "../primitives/Stage";
import {
	Avatar,
	Badge,
	Bar,
	Bubble,
	Card,
	Chip,
	Connector,
} from "../primitives/shapes";

/**
 * The chat story: channels → a mention → it reaches them → a reply in thread.
 *
 * The claim the product page makes is that the conversation sits BESIDE the
 * work rather than in another tool, and the only way to show that is to show
 * the rail and the thread in one frame: a project's channels on the left, the
 * thread open on the right, and a message doing something that a screenshot of
 * a chat window cannot — reaching a person.
 *
 * So one message is followed door to door, the way BoardEmptyStory follows one
 * card. It arrives in #general carrying an @-mention, the mention travels up to
 * the inbox pill and pops a count there, and the person it reached replies in a
 * thread docked under it. Three beats, one causal chain — the notification is
 * the middle link, which is why it gets a whole beat rather than being a badge
 * that was always on.
 *
 * LABEL DISCIPLINE, as in the other stories: `#general` is the one channel every
 * project is actually provisioned with (`channelSuggestions.ts`), the other two
 * rail rows are the generic kind of channel a team creates for itself, and
 * "Chat", "Inbox" and "Reply" are lifted from the nav, the inbox route and
 * `MessageActionsMenu`. The mention resolves to a CONTRACT POSITION rather than
 * to a person's name — inventing a display name here would be inventing a
 * colleague. The two lines of dialogue are deliberately claim-free: a question
 * about a task and an acknowledgement, nothing a viewer could remember as a
 * promise, and the older message stays redacted into bars for the same reason.
 *
 * The typing dots before the message lands are not decoration. Without them the
 * bubble reads as having always been there, and the whole beat depends on it
 * ARRIVING while you watch.
 *
 * Every scene element reads the GLOBAL frame and lives outside every
 * <Sequence>; only the captions are wrapped, because inside a Sequence
 * `useCurrentFrame()` is beat-local and the mention's cross-beat trip from the
 * bubble to the inbox pill would restart at each boundary.
 *
 * LIGHT palette: this sits on the product page beside three other light clips,
 * where a navy slab reads as a foreign object. See McpStory's note, and
 * palette.ts for what a light ground costs at the embed's edge.
 */

const CAPTIONS = [
	{ eyebrow: "Channels", line: "Chat that lives in the project" },
	{ eyebrow: "Mention", line: "Pull someone into the thread" },
	{ eyebrow: "Reach", line: "It lands in their inbox" },
	{ eyebrow: "Reply", line: "Answers stay next to the work" },
] as const;

const RAIL = { x: 150, y: 170, w: 400, h: 590 } as const;
const PANEL = { x: 610, y: 170, w: 1160, h: 590 } as const;

/**
 * The rail. `general` is the channel a project is born with; the other two are
 * the sort a team makes for itself, named generically on purpose — a rail full
 * of invented channel names would be a rail full of invented product.
 */
const CHANNELS = [
	{ name: "general", y: 300 },
	{ name: "design", y: 392 },
	{ name: "delivery", y: 484 },
] as const;
const ROW = { x: 174, w: 352, h: 72 } as const;

/** The message carrying the mention, and the thread reply docked under it. */
const MENTION = { x: 726, y: 386, w: 468, h: 84 } as const;
const MENTION_CHIP = { x: MENTION.x + MENTION.w + 24, y: MENTION.y + 20 } as const;
const REPLY = { x: 822, y: 546, w: 320, h: 76 } as const;

/**
 * The arc the mention travels, from the chip to the inbox pill. The Connector
 * and the dot riding it are the SAME quadratic — the control point is shared so
 * the dot cannot drift off its own path.
 */
const TRIP_FROM = [1308, 400] as const;
const TRIP_CTRL = [1430, 286] as const;
const TRIP_TO = [1500, 158] as const;
const TRIP_PATH = `M ${TRIP_FROM[0]} ${TRIP_FROM[1]} Q ${TRIP_CTRL[0]} ${TRIP_CTRL[1]} ${TRIP_TO[0]} ${TRIP_TO[1]}`;

/** The elbow that makes the reply read as a thread rather than as a next message. */
const THREAD_PATH = "M 744 474 L 744 570 Q 744 586 760 586 L 806 586";

export const ChatStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// The whole scene is torn down before the loop point, so frame 329 and frame
	// 0 are the same empty ground and the cut between them is invisible.
	const out = lerp(frame, [298, 314], [1, 0], EASE_OUT);

	const railIn = springIn(frame, fps, 4, 26);
	const panelIn = springIn(frame, fps, 10, 26);
	const selected = springIn(frame, fps, 34, 22);
	const composerIn = springIn(frame, fps, 30, 22);

	// ── Beat 1: the message already in the channel, redacted into bars.
	const seatedIn = springIn(frame, fps, 48, 24);
	const seatedBars = [
		lerp(frame, [58, 80], [0, 1], EASE_OUT),
		lerp(frame, [64, 86], [0, 1], EASE_OUT),
	];

	// ── Beat 2: someone is typing, then the message lands with the mention.
	const typing =
		lerp(frame, [84, 90], [0, 1], EASE_OUT) *
		(1 - lerp(frame, [92, 98], [0, 1], EASE_OUT));
	const mentionIn = springIn(frame, fps, 96, 24);
	const mentionLabel = lerp(frame, [104, 128], [0, 1], EASE_OUT);
	const chipIn = springIn(frame, fps, 128, 20);

	// ── Beat 3: the mention leaves the bubble and lands in the inbox.
	const tripDraw = lerp(frame, [168, 192], [0, 1], EASE_OUT);
	const tripFade = Math.min(
		lerp(frame, [168, 174], [0, 1]),
		lerp(frame, [202, 218], [1, 0], EASE_OUT),
	);
	const tripT = lerp(frame, [170, 200], [0, 1], EASE_IN_OUT);
	const dotFade = Math.min(
		lerp(frame, [170, 178], [0, 1]),
		lerp(frame, [194, 202], [1, 0]),
	);
	const [dotX, dotY] = bezier(tripT, TRIP_FROM, TRIP_CTRL, TRIP_TO);
	const pillIn = springIn(frame, fps, 196, 24);
	const countIn = springIn(frame, fps, 206, 18);
	// Gated by the entrance: a bare decay reads 1 at frame 0, where lerp clamps
	// to its left edge, and would leave a ring hanging on the loop seam.
	const pillRing = pillIn * lerp(frame, [204, 228], [1, 0], EASE_OUT);

	// ── Beat 4: the reply docks under the message and its author reacts.
	const threadDraw = lerp(frame, [250, 270], [0, 1], EASE_OUT);
	const markerIn = springIn(frame, fps, 252, 20);
	const replyIn = springIn(frame, fps, 258, 24);
	const replyLabel = lerp(frame, [268, 288], [0, 1], EASE_OUT);
	const reactIn = springIn(frame, fps, 272, 22);
	const reactRing = reactIn * lerp(frame, [278, 298], [1, 0], EASE_OUT);

	return (
		<Stage palette={LIGHT_PALETTE}>
			<div style={{ opacity: out }}>
				{/* ---------- The channel rail ---------- */}
				<div style={{ opacity: railIn }}>
					<Card
						x={RAIL.x}
						y={RAIL.y}
						w={RAIL.w}
						h={RAIL.h}
						radius={22}
						scale={0.96 + 0.04 * railIn}
					/>
					<Chip x={RAIL.x + 32} y={RAIL.y + 30} label="Chat" tone="outline" />
					<Bar x={RAIL.x + 32} y={RAIL.y + 98} w={336} h={2} opacity={0.8} />

					{CHANNELS.map((channel, i) => {
						const rowIn = springIn(frame, fps, 16 + i * 7, 22);
						const isOpen = i === 0;
						return (
							<div key={channel.name} style={{ opacity: rowIn }}>
								{/* Only the open channel gets a sheet under it; the others are
								    bare rows, which is what selection looks like. */}
								{isOpen ? (
									<Card
										x={ROW.x}
										y={channel.y}
										w={ROW.w}
										h={ROW.h}
										radius={16}
										tone="surfaceHi"
										opacity={selected}
										scale={0.97 + 0.03 * selected}
									/>
								) : null}
								{isOpen ? (
									<Bar
										x={RAIL.x + 10}
										y={channel.y + 18}
										w={6}
										h={36}
										radius={3}
										tone="primary"
										opacity={selected}
									/>
								) : null}
								<ChannelRow
									x={ROW.x + 26}
									y={channel.y}
									h={ROW.h}
									name={channel.name}
									open={isOpen}
								/>
							</div>
						);
					})}
				</div>

				{/* ---------- The thread ---------- */}
				<div style={{ opacity: panelIn }}>
					<Card
						x={PANEL.x}
						y={PANEL.y}
						w={PANEL.w}
						h={PANEL.h}
						radius={22}
						scale={0.96 + 0.04 * panelIn}
					/>
					<Chip
						x={PANEL.x + 38}
						y={PANEL.y + 30}
						label="#general"
						tone="outline"
					/>
					<Bar x={PANEL.x + 38} y={PANEL.y + 92} w={1084} h={2} opacity={0.8} />

					{/* The message that was already here. It stays redacted: a second
					    line of invented dialogue buys nothing and risks a claim. */}
					<div style={{ opacity: seatedIn }}>
						<Avatar x={650} y={286} size={56} variant={0} scale={0.8 + 0.2 * seatedIn} />
						<Bubble
							x={726}
							y={280}
							w={430}
							h={80}
							scale={0.94 + 0.06 * seatedIn}
						/>
						<Bar x={750} y={306} w={300} h={11} reveal={seatedBars[0]} />
						<Bar x={750} y={332} w={200} h={9} reveal={seatedBars[1]} opacity={0.9} />
					</div>

					{/* Someone is typing, in the slot the message is about to fill. */}
					<TypingDots frame={frame} x={750} y={420} opacity={typing} />

					{/* The message carrying the mention. */}
					<div style={{ opacity: mentionIn }}>
						<Avatar x={650} y={392} size={56} variant={1} scale={0.8 + 0.2 * mentionIn} />
						<Bubble
							x={MENTION.x}
							y={MENTION.y}
							w={MENTION.w}
							h={MENTION.h}
							label="Who's on this task?"
							labelReveal={mentionLabel}
							scale={0.94 + 0.06 * mentionIn}
						/>
					</div>

					{/* The mention itself: a primary token trailing the bubble, on the
					    ground rather than on the fill, so it reads as a thing that can
					    be picked up and sent somewhere. */}
					<div style={{ opacity: chipIn }}>
						<Chip
							x={MENTION_CHIP.x}
							y={MENTION_CHIP.y}
							label="@Consultant"
							tone="primary"
							scale={0.86 + 0.14 * chipIn}
						/>
					</div>

					{/* The thread: an elbow down to an indented reply. */}
					<Connector
						d={THREAD_PATH}
						progress={threadDraw}
						tone="muted"
						width={3}
						opacity={0.7}
					/>
					<div style={{ opacity: markerIn }}>
						<Chip x={REPLY.x} y={486} label="Reply" tone="muted" scale={0.9 + 0.1 * markerIn} />
					</div>
					<div style={{ opacity: replyIn }}>
						<Bubble
							x={REPLY.x}
							y={REPLY.y}
							w={REPLY.w}
							h={REPLY.h}
							tone="user"
							label="On it"
							labelReveal={replyLabel}
							scale={0.94 + 0.06 * replyIn}
						/>
					</div>

					{/* Whoever was mentioned, now in the thread. The ring is the react. */}
					<Avatar
						x={REPLY.x + REPLY.w + 24}
						y={REPLY.y + 10}
						size={56}
						variant={2}
						opacity={reactIn}
						ring={reactRing}
						scale={0.8 + 0.2 * reactIn}
					/>

					{/* The composer, so the panel reads as a chat rather than a feed. */}
					<div style={{ opacity: composerIn }}>
						<Card
							x={PANEL.x + 38}
							y={668}
							w={1084}
							h={56}
							radius={28}
							tone="surfaceHi"
							opacity={0.9}
						/>
						<Bar x={PANEL.x + 66} y={690} w={260} h={10} opacity={0.7} />
						<Badge x={1676} y={676} r={20} scale={0.9 + 0.1 * composerIn}>
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
					</div>
				</div>

				{/* ---------- The mention's trip, and where it lands ---------- */}
				<Connector
					d={TRIP_PATH}
					progress={tripDraw}
					tone="primary"
					width={3}
					opacity={tripFade * 0.8}
				/>
				<TripDot x={dotX} y={dotY} opacity={dotFade} />

				<div style={{ opacity: pillIn }}>
					<Card
						x={1360}
						y={64}
						w={410}
						h={88}
						radius={44}
						tone="surfaceHi"
						glow={0.5 * pillRing}
						scale={0.92 + 0.08 * pillIn}
					/>
					<Avatar x={1382} y={80} size={56} variant={2} ring={pillRing} />
					<Chip x={1454} y={86} label="Inbox" tone="muted" />
					<div style={{ opacity: countIn }}>
						<Badge x={1666} y={80} r={28} scale={0.7 + 0.3 * countIn}>
							<Count value={1} />
						</Badge>
					</div>
				</div>
			</div>

			<CaptionTrack items={CAPTIONS} />
		</Stage>
	);
};

/**
 * A rail row. Not a `Chip`: a channel in the sidebar is a line of text with a
 * hash in front of it, and a pill here would make three of them look like three
 * tags. The hash keeps the muted tone even on the open row — it is punctuation,
 * not part of the name.
 */
const ChannelRow: React.FC<{
	x: number;
	y: number;
	h: number;
	name: string;
	open: boolean;
}> = ({ x, y, h, name, open }) => {
	const PALETTE = usePalette();
	return (
		<div
			style={{
				position: "absolute",
				left: x,
				top: y,
				height: h,
				display: "flex",
				alignItems: "center",
				gap: 10,
				fontFamily: FONT_BODY,
				fontSize: 26,
				fontWeight: open ? 700 : 600,
				letterSpacing: "0.01em",
				color: open ? PALETTE.ink : PALETTE.inkMuted,
			}}
		>
			<span style={{ color: PALETTE.inkMuted, fontWeight: 600 }}>#</span>
			{name}
		</div>
	);
};

/** The count inside the inbox badge. A count, never a quantity of anything else. */
const Count: React.FC<{ value: number }> = ({ value }) => (
	<div
		style={{
			fontFamily: FONT_BODY,
			fontSize: 26,
			fontWeight: 700,
			color: "#ffffff",
		}}
	>
		{value}
	</div>
);

/**
 * The typing indicator. It holds the slot the incoming message is about to
 * fill, which is what makes that message read as arriving rather than as having
 * been on screen all along.
 */
const TypingDots: React.FC<{
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

/** The mention in flight, riding the same quadratic the connector draws. */
const TripDot: React.FC<{ x: number; y: number; opacity: number }> = ({
	x,
	y,
	opacity,
}) => {
	const PALETTE = usePalette();
	return (
		<div
			style={{
				position: "absolute",
				left: x - 11,
				top: y - 11,
				width: 22,
				height: 22,
				borderRadius: 11,
				backgroundColor: PALETTE.blue600,
				boxShadow: `0 0 0 8px rgba(${PALETTE.glowRgb},0.14)`,
				opacity,
			}}
		/>
	);
};

/** Rendered inside AbsoluteFill so the stage is exactly 1920x1080. */
export const ChatStage: React.FC = () => (
	<AbsoluteFill>
		<ChatStory />
	</AbsoluteFill>
);
