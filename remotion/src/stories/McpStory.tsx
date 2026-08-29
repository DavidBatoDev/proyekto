import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_OUT, lerp, springIn } from "../anim";
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
 * The MCP story: connect → scopes → in use → control.
 *
 * The four beats are the four sentences `/settings/mcp-tokens` already leads
 * with — point a host at the server, grant only the scopes you approve, let it
 * work with real project data, and keep access re-checked on every call and
 * revocable. The video states nothing the page does not.
 *
 * The host side is a chat thread, because that is what an MCP host actually is
 * to the person using it: you ask a question in a chat and the answer comes
 * back from your own project. The abstract content bars it replaced said
 * "some data moved" and left the viewer to guess who was asking.
 *
 * The two lines of dialogue are deliberately claim-free. The question names
 * only the roadmap; the answer says where it came from and then redacts into
 * bars, because a fabricated "3 tasks left" is exactly the kind of number a
 * viewer would remember as a promise.
 *
 * LABEL DISCIPLINE, same as the other two stories: only vocabulary that exists
 * in the product. The four scope rows are the real labels out of `SCOPE_META`
 * in the settings page (Projects, Roadmaps & tasks, Chat, Edit roadmaps), and
 * the write row is deliberately left UNTICKED — a video that ticked everything
 * would contradict the one guarantee this screen makes. No host is named:
 * which hosts speak MCP changes faster than a baked MP4 can.
 *
 * Every element reads the GLOBAL frame. Only the captions sit inside a
 * <Sequence>, because inside one `useCurrentFrame()` is beat-local and the
 * cross-beat moves here need the global clock.
 *
 * THIS ONE IS LIGHT. The two /start-selling clips sit on navy because a
 * marketing inset wants to separate itself from the page; this one is embedded
 * beside body copy in settings, where a dark slab reads as a foreign object.
 * It therefore uses LIGHT_PALETTE, which is the shipped
 * `html[data-ui-theme="light"]` contract out of web/src/styles.css, and reads
 * as another card on the page. The cost is real and is documented in
 * palette.ts: white cannot separate from a #f9fafb page by luminance, so the
 * embed's `border border-border` is the only thing drawing its edge, and on a
 * dark theme this panel stays light rather than following the page.
 */

const CAPTIONS = [
	{ eyebrow: "Connect", line: "Point your MCP host at Proyekto" },
	{ eyebrow: "Scopes", line: "Grant only the access you approve" },
	{ eyebrow: "In use", line: "Ask it, and it answers from your project" },
	{ eyebrow: "Control", line: "Checked every call — revoke anytime" },
] as const;

const HOST = { x: 210, y: 230, w: 560, h: 470 } as const;
const SERVER = { x: 1150, y: 230, w: 560, h: 470 } as const;

/** The wire, and the midpoint the token badge sits on. */
const WIRE = `M ${HOST.x + HOST.w} 470 L ${SERVER.x} 470`;
const WIRE_MID = (HOST.x + HOST.w + SERVER.x) / 2;

/**
 * The granted set. `write: true` marks the row that stays unticked — see the
 * label-discipline note above.
 */
const SCOPES = [
	{ label: "Projects", write: false },
	{ label: "Roadmaps & tasks", write: false },
	{ label: "Chat", write: false },
	{ label: "Edit roadmaps", write: true },
] as const;

/** What the host pulls back over the wire once it is connected. */
const PACKETS = [
	{ label: "Roadmap", at: 162 },
	{ label: "Tasks", at: 190 },
] as const;

/**
 * "Re-checked on every call" — the badge ticks once per request rather than
 * once per session, which is what the backend actually does.
 */
const CHECKS = [166, 194, 262, 278] as const;

export const McpStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const palette = LIGHT_PALETTE;

	// The whole scene is torn down before the loop point, so the last frames and
	// the first frames are the same empty ground and the cut is invisible.
	const out = lerp(frame, [300, 316], [1, 0], EASE_OUT);

	const hostIn = springIn(frame, fps, 8, 26);
	const serverIn = springIn(frame, fps, 18, 26);

	// The wire draws in beat 1 and retracts in beat 4 — revoking is the wire
	// going away, not a card turning red.
	const wire = Math.min(
		lerp(frame, [26, 52], [0, 1], EASE_OUT),
		lerp(frame, [290, 306], [1, 0], EASE_OUT),
	);
	const tokenIn = springIn(frame, fps, 40, 24);

	// Revoking runs in sequence, never as a crossfade: the two chips are
	// different widths, so overlapping them ghosts one behind the other.
	const tokenOut = lerp(frame, [284, 292], [1, 0], EASE_OUT);
	const revoked = lerp(frame, [292, 300], [0, 1], EASE_OUT);

	// ── The conversation.
	// Typed, then cleared by the send: the composer emptying is what makes the
	// bubble read as having been sent rather than having always been there.
	const composer =
		lerp(frame, [16, 38], [0, 1], EASE_OUT) *
		(1 - lerp(frame, [40, 46], [0, 1], EASE_OUT));
	const askIn = springIn(frame, fps, 44, 22);

	// The reply waits for the data: the last packet lands at 216, so the dots
	// hold the turn until then and the answer writes itself straight after.
	const replyIn = springIn(frame, fps, 168, 24);
	const thinking = lerp(frame, [214, 224], [1, 0], EASE_OUT);
	const replyLabel = lerp(frame, [220, 238], [0, 1], EASE_OUT);
	const replyBars = [
		lerp(frame, [228, 244], [0, 1], EASE_OUT),
		lerp(frame, [234, 250], [0, 1], EASE_OUT),
		lerp(frame, [240, 256], [0, 1], EASE_OUT),
	];

	return (
		<Stage palette={palette}>
			<div style={{ opacity: out }}>
				{/* ---------- The wire between them ---------- */}
				<Connector d={WIRE} progress={wire} tone="primary" width={3} />

				{/* ---------- Host: the chat ---------- */}
				<div style={{ opacity: hostIn }}>
					<Card
						x={HOST.x}
						y={HOST.y}
						w={HOST.w}
						h={HOST.h}
						scale={0.94 + 0.06 * hostIn}
					/>
					<Chip x={HOST.x + 36} y={HOST.y + 34} label="MCP host" tone="outline" />

					{/* The credential lives in the header. Revoking swaps it for a
					    spent one; the two never crossfade, they take turns. */}
					<div style={{ opacity: tokenIn * tokenOut }}>
						<Chip
							x={HOST.x + 350}
							y={HOST.y + 34}
							label="Access token"
							tone="primary"
						/>
					</div>
					<div style={{ opacity: revoked }}>
						<Chip
							x={HOST.x + 350}
							y={HOST.y + 34}
							label="Revoked"
							tone="muted"
						/>
					</div>

					{/* What the person asked. */}
					<Bubble
						x={350}
						y={330}
						w={380}
						h={64}
						tone="user"
						label="What's left on the roadmap?"
						opacity={askIn}
						scale={0.92 + 0.08 * askIn}
					/>

					{/* What came back. It cannot answer before the data arrives, so the
					    thinking dots hold the turn until the last packet lands. */}
					<div style={{ opacity: replyIn }}>
						<Bubble
							x={250}
							y={424}
							w={430}
							h={160}
							label="From your roadmap:"
							labelReveal={replyLabel}
							scale={0.94 + 0.06 * replyIn}
						/>
						<ThinkingDots frame={frame} x={276} y={464} opacity={thinking} />
						<Bar x={272} y={486} w={330} h={10} reveal={replyBars[0]} />
						<Bar x={272} y={512} w={270} h={10} reveal={replyBars[1]} />
						<Bar x={272} y={538} w={300} h={10} reveal={replyBars[2]} />
					</div>

					{/* The composer, typed into and then cleared by the send. */}
					<Card
						x={250}
						y={616}
						w={470}
						h={56}
						radius={28}
						tone="surfaceHi"
						opacity={0.9}
					/>
					<Bar x={278} y={638} w={260} h={10} reveal={composer} />
					<Badge x={664} y={624} r={20} scale={0.9 + 0.1 * tokenIn}>
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

				{/* ---------- Proyekto ---------- */}
				<div style={{ opacity: serverIn }}>
					<Card
						x={SERVER.x}
						y={SERVER.y}
						w={SERVER.w}
						h={SERVER.h}
						scale={0.94 + 0.06 * serverIn}
					/>
					<Chip
						x={SERVER.x + 36}
						y={SERVER.y + 34}
						label="Proyekto"
						tone="primary"
					/>

					{SCOPES.map((scope, i) => {
						const rowIn = springIn(frame, fps, 84 + i * 8, 22);
						const y = SERVER.y + 118 + i * 82;
						// The read rows tick; the write row is left for the viewer to
						// notice, which is the whole point of the beat.
						const tick = scope.write
							? 0
							: lerp(frame, [106 + i * 10, 128 + i * 10], [0, 1], EASE_OUT);
						return (
							<div key={scope.label} style={{ opacity: rowIn }}>
								<Card
									x={SERVER.x + 32}
									y={y}
									w={SERVER.w - 64}
									h={64}
									radius={14}
									tone={scope.write ? "surface" : "surfaceHi"}
									scale={0.94 + 0.06 * rowIn}
								/>
								<Chip
									x={SERVER.x + 52}
									y={y + 10}
									label={scope.label}
									tone="muted"
								/>
								{scope.write ? (
									<div
										style={{
											position: "absolute",
											left: SERVER.x + SERVER.w - 96,
											top: y + 18,
											width: 28,
											height: 28,
											borderRadius: 14,
											border: `2px solid ${palette.bar}`,
										}}
									/>
								) : (
									<CheckMark
										x={SERVER.x + SERVER.w - 104}
										y={y + 12}
										size={40}
										progress={tick}
									/>
								)}
							</div>
						);
					})}
				</div>

				{/* ---------- The token on the wire, and the per-call check ---------- */}
				<CallBadge frame={frame} fps={fps} wire={wire} />

				{/* ---------- Data coming back ---------- */}
				{PACKETS.map((packet) => {
					// 26 frames door to door, and the labels are 28 apart, so two
					// packets are never on the wire at once — overlapping chips read as
					// one smeared word.
					const t = lerp(frame, [packet.at, packet.at + 26], [1, 0], EASE_OUT);
					const fade = Math.min(
						lerp(frame, [packet.at, packet.at + 6], [0, 1]),
						lerp(frame, [packet.at + 20, packet.at + 26], [1, 0]),
					);
					return (
						<Chip
							key={packet.label}
							x={lerp(t, [0, 1], [HOST.x + HOST.w + 30, SERVER.x - 170])}
							y={556}
							label={packet.label}
							tone="primary"
							opacity={fade}
						/>
					);
				})}
			</div>

			<CaptionTrack items={CAPTIONS} />
		</Stage>
	);
};

/**
 * The three dots a chat shows while the other side is working. They hold the
 * turn between the question and the answer, which is what makes the wire
 * traffic in between read as the answer being fetched rather than as ambient
 * motion.
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
				const lift = lerp(phase, [0, 8], [0, 1], EASE_OUT) * lerp(phase, [8, 18], [1, 0], EASE_OUT);
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

/**
 * The badge riding the middle of the wire.
 *
 * It carries the key while the connection is being made, then ticks once per
 * call — the pulse is what carries "re-checked on every call", which is a
 * property of the backend and not something a static shield could say.
 */
const CallBadge: React.FC<{ frame: number; fps: number; wire: number }> = ({
	frame,
	fps,
	wire,
}) => {
	const PALETTE = usePalette();
	const badgeIn = springIn(frame, fps, 46, 24);
	// Out ahead of the wire: a dimmed badge hanging on a half-retracted line
	// reads as an artefact rather than as access being cut.
	const opacity = badgeIn * wire * lerp(frame, [282, 292], [1, 0], EASE_OUT);

	// The most recent pulse wins; they never overlap (18 frames apart, 14 long).
	const pulse = CHECKS.reduce(
		(acc, at) => Math.max(acc, lerp(frame, [at, at + 14], [1, 0], EASE_OUT)),
		0,
	);
	const tick = CHECKS.reduce(
		(acc, at) => Math.max(acc, lerp(frame, [at, at + 10], [0, 1], EASE_OUT)),
		0,
	);

	return (
		<div style={{ opacity }}>
			{/* The ring a call leaves behind. */}
			<div
				style={{
					position: "absolute",
					left: WIRE_MID - 34,
					top: 470 - 34,
					width: 68,
					height: 68,
					borderRadius: 34,
					border: `2px solid ${PALETTE.blue400}`,
					opacity: pulse * 0.55,
					transform: `scale(${1 + 1.4 * (1 - pulse)})`,
					transformOrigin: "center center",
				}}
			/>
			<Badge x={WIRE_MID - 34} y={470 - 34} r={34} scale={1 + 0.06 * pulse}>
				<svg width={34} height={34} viewBox="0 0 24 24" fill="none">
					<title>verified call</title>
					{/* The shield outline is always there; the tick draws per call. */}
					<path
						d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6l7-3z"
						stroke="#ffffff"
						strokeWidth={1.6}
						strokeLinejoin="round"
						opacity={0.55}
					/>
					<path
						d="M8.6 12.1l2.4 2.4 4.4-4.6"
						stroke="#ffffff"
						strokeWidth={2}
						strokeLinecap="round"
						strokeLinejoin="round"
						pathLength={1}
						strokeDasharray={1}
						strokeDashoffset={1 - tick}
					/>
				</svg>
			</Badge>
		</div>
	);
};

/** Rendered inside AbsoluteFill so the stage is exactly 1920x1080. */
export const McpStage: React.FC = () => (
	<AbsoluteFill>
		<McpStory />
	</AbsoluteFill>
);
