import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_OUT, lerp, springIn } from "../anim";
import { PALETTE } from "../brand/palette";
import { CaptionTrack } from "../primitives/Caption";
import { Stage } from "../primitives/Stage";
import { Badge, Bar, Card, CheckMark, Chip, Connector } from "../primitives/shapes";

/**
 * The MCP story: connect → scopes → in use → control.
 *
 * The four beats are the four sentences `/settings/mcp-tokens` already leads
 * with — point a host at the server, grant only the scopes you approve, let it
 * work with real project data, and keep access re-checked on every call and
 * revocable. The video states nothing the page does not.
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
 */

const CAPTIONS = [
	{ eyebrow: "Connect", line: "Point your MCP host at Proyekto" },
	{ eyebrow: "Scopes", line: "Grant only the access you approve" },
	{ eyebrow: "In use", line: "It works with your real project data" },
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
	{ label: "Roadmap", at: 176 },
	{ label: "Tasks", at: 194 },
	{ label: "Chat", at: 212 },
] as const;

/**
 * "Re-checked on every call" — the badge ticks once per request rather than
 * once per session, which is what the backend actually does.
 */
const CHECKS = [180, 198, 216, 262, 278] as const;

export const McpStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

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

	// Beat 1: the endpoint being entered on the host side.
	const endpoint = lerp(frame, [20, 44], [0, 1], EASE_OUT);
	const hostLine = lerp(frame, [28, 50], [0, 1], EASE_OUT);

	return (
		<Stage>
			<div style={{ opacity: out }}>
				{/* ---------- The wire between them ---------- */}
				<Connector d={WIRE} progress={wire} tone="primary" width={3} />

				{/* ---------- Host ---------- */}
				<div style={{ opacity: hostIn }}>
					<Card
						x={HOST.x}
						y={HOST.y}
						w={HOST.w}
						h={HOST.h}
						scale={0.94 + 0.06 * hostIn}
					/>
					<Chip x={HOST.x + 36} y={HOST.y + 34} label="MCP host" tone="outline" />

					{/* The endpoint, typed in. */}
					<Bar
						x={HOST.x + 36}
						y={HOST.y + 130}
						w={300}
						h={10}
						reveal={endpoint}
						tone="primary"
					/>
					<Bar
						x={HOST.x + 36}
						y={HOST.y + 164}
						w={420}
						h={10}
						reveal={hostLine}
					/>

					{/* What comes back over the wire, written line by line. */}
					{PACKETS.map((packet, i) => (
						<Bar
							key={`row-${packet.label}`}
							x={HOST.x + 36}
							y={HOST.y + 236 + i * 34}
							w={[440, 366, 402][i]}
							h={10}
							reveal={lerp(frame, [packet.at + 20, packet.at + 40], [0, 1])}
						/>
					))}

					{/* The credential. Revoking swaps it for a spent one. */}
					<div style={{ opacity: tokenIn * tokenOut }}>
						<Chip
							x={HOST.x + 36}
							y={HOST.y + 372}
							label="Access token"
							tone="primary"
						/>
					</div>
					<div style={{ opacity: revoked }}>
						<Chip
							x={HOST.x + 36}
							y={HOST.y + 372}
							label="Revoked"
							tone="muted"
						/>
					</div>
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
											border: `2px solid ${PALETTE.bar}`,
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
					const t = lerp(frame, [packet.at, packet.at + 30], [1, 0], EASE_OUT);
					const fade = Math.min(
						lerp(frame, [packet.at, packet.at + 8], [0, 1]),
						lerp(frame, [packet.at + 22, packet.at + 30], [1, 0]),
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
