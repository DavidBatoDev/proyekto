import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_IN_OUT, EASE_OUT, bezier, lerp, springIn } from "../anim";
import { FONT_BODY } from "../brand/fonts";
import { PALETTE } from "../brand/palette";
import { CaptionTrack } from "../primitives/Caption";
import { Stage } from "../primitives/Stage";
import { Avatar, Badge, Bar, Card, CheckMark, Chip, Connector } from "../primitives/shapes";

/**
 * The talent story: profile → terms → staffing → paid.
 *
 * The four beats mirror the four records the page already names in
 * `HowYouGetPaid.tsx` (contract → deliverable → invoice → payout), plus the
 * profile `GoLiveChecklist.tsx` asks for. Nothing here is invented.
 *
 * NOTE ON LABELS: only verified product vocabulary appears as text. No rate,
 * amount, percentage, fee or timeline — `WhyStartSelling.tsx` and
 * `HowYouGetPaid.tsx` both deliberately refuse to state those, and a number
 * baked into a video would be the one thing a viewer remembers. The rate module
 * therefore renders its amount as redacted bars, never digits, and the skill
 * pills are unlabelled because the real taxonomy is fetched live.
 *
 * Every element below reads the GLOBAL frame. Only the captions sit inside a
 * <Sequence>, because inside one `useCurrentFrame()` returns a beat-local frame
 * and the cross-beat moves here need the global clock.
 */

const CAPTIONS = [
	{ eyebrow: "Profile", line: "A profile clients can hire from" },
	{ eyebrow: "Terms", line: "Your rate, your hours, your currency" },
	{ eyebrow: "Staffing", line: "Vetted leads staff you onto real projects" },
	{ eyebrow: "Paid", line: "Accepted, invoiced, paid out" },
] as const;

/** The pose held at both ends of the loop. */
const SEED = { x: 760, y: 260, w: 400, h: 480 };

export const TalentStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// ── The profile card: present in beats 1-2, gone in 3, back at seed in 4.
	// Slides left and shrinks to make room for the rate card, then slides back
	// so the last frame matches the first. The return happens at 286-306, while
	// the card is still fully transparent, so the move itself is never seen —
	// without it the loop would jump 470px sideways.
	const shift = Math.min(
		lerp(frame, [84, 106], [0, 1], EASE_IN_OUT),
		lerp(frame, [286, 306], [1, 0], EASE_IN_OUT),
	);
	const cardScale = 1 - 0.14 * shift;
	const cardX = SEED.x - 470 * shift;
	const cardY = SEED.y + 34 * shift;
	const cardW = SEED.w * cardScale;
	const cardH = SEED.h * cardScale;

	// Out during the roadmap beat, back for the loop return.
	const profileOut = lerp(frame, [162, 178], [1, 0], EASE_OUT);
	const profileBack = lerp(frame, [300, 320], [0, 1], EASE_OUT);
	const profileOpacity = Math.max(profileOut, profileBack);

	// Content inside the card, in the order it is built.
	const sw = cardW / SEED.w;
	const sh = cardH / SEED.h;
	const avatarSize = 96 * sw;
	const avatarX = cardX + cardW / 2 - avatarSize / 2;
	const avatarY = cardY + 52 * sh;

	// Beat-1 build, torn down again for the loop return.
	const build = lerp(frame, [306, 320], [1, 0], EASE_OUT);
	const roleReveal = lerp(frame, [16, 34], [0, 1]) * build;
	const bar1 = lerp(frame, [24, 42], [0, 1]) * build;
	const bar2 = lerp(frame, [30, 48], [0, 1]) * build;
	const pillsIn = springIn(frame, fps, 40, 24) * build;
	const tileIn = springIn(frame, fps, 54, 26) * build;

	// ── The rate card.
	const rateIn = springIn(frame, fps, 96, 26);
	const rateOut = lerp(frame, [162, 176], [1, 0], EASE_OUT);
	const rateOpacity = rateIn * rateOut;
	const sliderDraw = lerp(frame, [108, 130], [0, 1], EASE_OUT);
	const handleT = springIn(frame, fps, 112, 24);
	const toggleT = lerp(frame, [132, 150], [0, 1], EASE_OUT);

	// ── The roadmap the talent gets staffed onto.
	const spine = lerp(frame, [174, 194], [0, 1], EASE_OUT);
	// Cleared entirely rather than dimmed: the records land in this space, and a
	// ghosted roadmap behind them just reads as clutter.
	const roadmapOut = lerp(frame, [252, 272], [1, 0], EASE_OUT);
	const roadmapOpacity = lerp(frame, [170, 184], [0, 1]) * roadmapOut;

	// ── The three records: accepted, invoiced, paid out.
	// Timed so the last card has settled by ~296, leaving a clear hold before
	// the return begins at 304.
	const recordsOut = lerp(frame, [304, 320], [1, 0], EASE_OUT);

	return (
		<Stage>
			{/* ---------- Roadmap + docked talent (beats 3-4) ---------- */}
			<div style={{ opacity: roadmapOpacity }}>
				<Connector d="M 1080 250 L 1080 780" progress={spine} width={3} />
				{ROADMAP_NODES.map((node, i) => {
					const t = springIn(frame, fps, 182 + i * 5, 22);
					return (
						<div key={node.label} style={{ opacity: t }}>
							<Card
								x={node.x}
								y={node.y}
								w={node.w}
								h={64}
								radius={14}
								scale={0.9 + 0.1 * t}
								tone={i === 0 ? "surfaceHi" : "surface"}
							/>
							<Chip
								x={node.x + 20}
								y={node.y + 10}
								label={node.label}
								tone={i === 0 ? "primary" : "muted"}
								opacity={t}
							/>
						</div>
					);
				})}

				{/* Three talents fly out of the profile and dock onto task rows. */}
				{DOCKED.map((dock, i) => {
					const t = lerp(frame, [204 + i * 14, 226 + i * 14], [0, 1], EASE_IN_OUT);
					const [px, py] = bezier(
						t,
						[avatarX, avatarY],
						[620, 240],
						[dock.x, dock.y],
					);
					return (
						<Avatar
							key={dock.x}
							x={px}
							y={py}
							size={96}
							variant={i as 0 | 1 | 2}
							scale={lerp(t, [0, 1], [1, 0.56])}
							ring={lerp(frame, [222 + i * 14, 236 + i * 14], [0, 1])}
							opacity={lerp(frame, [200 + i * 14, 210 + i * 14], [0, 1])}
						/>
					);
				})}

				<Chip
					x={1120}
					y={172}
					label="Staffed"
					tone="primary"
					opacity={springIn(frame, fps, 238, 20)}
					scale={0.8 + 0.2 * springIn(frame, fps, 238, 20)}
				/>
			</div>

			{/* ---------- Profile card (beats 1-2, and the loop return) ---------- */}
			<div style={{ opacity: profileOpacity }}>
				<Card x={cardX} y={cardY} w={cardW} h={cardH} radius={20 * sw} />
				<Avatar x={avatarX} y={avatarY} size={avatarSize} variant={0} />
				{/* Name bar is part of the seed pose — always at full reveal. */}
				<Bar
					x={cardX + 80 * sw}
					y={cardY + 184 * sh}
					w={240 * sw}
					h={16 * sh}
					tone="ink"
					opacity={0.85}
				/>
				<Bar
					x={cardX + 120 * sw}
					y={cardY + 216 * sh}
					w={160 * sw}
					h={10 * sh}
					reveal={roleReveal}
				/>
				<Bar
					x={cardX + 48 * sw}
					y={cardY + 262 * sh}
					w={304 * sw}
					h={10 * sh}
					reveal={bar1}
				/>
				<Bar
					x={cardX + 48 * sw}
					y={cardY + 288 * sh}
					w={228 * sw}
					h={10 * sh}
					reveal={bar2}
				/>
				{/* Unlabelled skill pills — the real taxonomy is fetched live. */}
				{[120, 168, 96].map((w, i) => (
					<Bar
						key={w}
						x={cardX + (48 + (i === 0 ? 0 : i === 1 ? 132 : 0)) * sw}
						y={cardY + (330 + (i === 2 ? 40 : 0)) * sh}
						w={w * sw}
						h={30 * sh}
						radius={15 * sh}
						tone="muted"
						opacity={pillsIn * 0.9}
					/>
				))}
				{/* One primary block carries the emphasis — the portfolio item. */}
				<Card
					x={cardX + 48 * sw}
					y={cardY + 400 * sh}
					w={304 * sw}
					h={54 * sh}
					radius={12}
					tone="primary"
					opacity={tileIn * 0.32}
				/>
				<Chip
					x={cardX + 62 * sw}
					y={cardY + 405 * sh}
					label="Portfolio"
					tone="outline"
					opacity={tileIn}
					scale={sw}
				/>
			</div>

			{/* ---------- Rate card (beat 2) ---------- */}
			<div style={{ opacity: rateOpacity }}>
				<Card x={900} y={300} w={560} h={320} radius={20} />
				<Chip x={940} y={336} label="Rate" tone="outline" />
				{/* Redacted amount: three bars, never digits. */}
				{[92, 60, 44].map((w, i) => (
					<Bar
						key={w}
						x={940 + (i === 0 ? 0 : i === 1 ? 104 : 176)}
						y={400}
						w={w}
						h={34}
						radius={8}
						tone="primary"
						opacity={lerp(frame, [112 + i * 5, 126 + i * 5], [0, 1])}
					/>
				))}
				<div
					style={{
						position: "absolute",
						left: 1236,
						top: 404,
						fontFamily: FONT_BODY,
						fontSize: 28,
						fontWeight: 600,
						color: PALETTE.inkMuted,
						opacity: lerp(frame, [124, 136], [0, 1]),
					}}
				>
					/ hr
				</div>

				<Bar x={940} y={472} w={480} h={8} tone="muted" reveal={sliderDraw} />
				<Bar x={940} y={472} w={480 * 0.62} h={8} tone="primary" reveal={sliderDraw} />
				<div
					style={{
						position: "absolute",
						left: 940 + 480 * 0.62 * handleT - 14,
						top: 462,
						width: 28,
						height: 28,
						borderRadius: 14,
						backgroundColor: PALETTE.blue500,
						opacity: handleT,
					}}
				/>

				<Chip
					x={940}
					y={530}
					label="Currency"
					opacity={springIn(frame, fps, 120, 20)}
				/>
				<Chip
					x={1090}
					y={530}
					label="Weekly hours"
					opacity={springIn(frame, fps, 126, 20)}
				/>

				{/* Availability toggle: the knob slides and the track turns primary. */}
				<div
					style={{
						position: "absolute",
						left: 1330,
						top: 534,
						width: 88,
						height: 40,
						borderRadius: 20,
						backgroundColor: PALETTE.bar,
						opacity: lerp(frame, [130, 142], [0, 1]),
					}}
				>
					<div
						style={{
							position: "absolute",
							inset: 0,
							borderRadius: 20,
							backgroundColor: PALETTE.blue600,
							opacity: toggleT,
						}}
					/>
					<div
						style={{
							position: "absolute",
							top: 5,
							left: 5 + 44 * toggleT,
							width: 30,
							height: 30,
							borderRadius: 15,
							backgroundColor: PALETTE.ink,
						}}
					/>
				</div>
			</div>

			{/* ---------- The three records (beat 4) ---------- */}
			<div style={{ opacity: recordsOut }}>
				{RECORDS.map((record, i) => {
					const t = springIn(frame, fps, 252 + i * 9, 26);
					const draw = lerp(frame, [268 + i * 9, 288 + i * 9], [0, 1], EASE_OUT);
					return (
						<div key={record.label} style={{ opacity: t }}>
							<Card
								x={record.x}
								y={lerp(t, [0, 1], [1120, 330])}
								w={380}
								h={320}
								radius={20}
								glow={i === 2 ? 0.5 * t : 0}
							/>
							<div
								style={{
									position: "absolute",
									left: record.x,
									top: lerp(t, [0, 1], [1120, 330]),
									width: 380,
									height: 320,
								}}
							>
								<Bar x={32} y={40} w={180} h={12} tone="muted" />
								<Bar x={32} y={70} w={120} h={10} tone="muted" opacity={0.7} />

								{i === 0 ? (
									<CheckMark x={150} y={120} size={80} progress={draw} tone="ok" />
								) : null}
								{i === 1
									? [220, 180, 240, 150].map((w, j) => (
											<Bar
												key={w}
												x={32}
												y={130 + j * 26}
												w={w}
												h={10}
												tone={j === 3 ? "primary" : "muted"}
												reveal={lerp(draw, [j * 0.2, j * 0.2 + 0.4], [0, 1])}
											/>
										))
									: null}
								{i === 2 ? (
									<Badge x={156} y={130} r={40} scale={draw}>
										<svg width="34" height="34" viewBox="0 0 24 24" fill="none">
											<title>payout</title>
											<path
												d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M4 19h16"
												stroke="#ffffff"
												strokeWidth={2.2}
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
									</Badge>
								) : null}

								<Chip
									x={32}
									y={252}
									label={record.label}
									tone={i === 2 ? "primary" : "outline"}
									opacity={draw}
								/>
							</div>
						</div>
					);
				})}
			</div>

			<CaptionTrack items={CAPTIONS} />
		</Stage>
	);
};

const ROADMAP_NODES = [
	{ label: "Epic", x: 1120, y: 262, w: 260 },
	{ label: "Feature", x: 1180, y: 392, w: 230 },
	{ label: "Feature", x: 1180, y: 502, w: 230 },
	{ label: "Task", x: 1240, y: 612, w: 200 },
] as const;

const DOCKED = [
	{ x: 1148, y: 610 },
	{ x: 1148, y: 500 },
	{ x: 1148, y: 390 },
] as const;

const RECORDS = [
	{ label: "Accepted", x: 300 },
	{ label: "Invoice", x: 770 },
	{ label: "Payout", x: 1240 },
] as const;

/** Rendered inside AbsoluteFill so the stage is exactly 1920x1080. */
export const TalentStage: React.FC = () => (
	<AbsoluteFill>
		<TalentStory />
	</AbsoluteFill>
);
