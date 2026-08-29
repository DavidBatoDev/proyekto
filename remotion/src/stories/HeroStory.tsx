import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_OUT, lerp, springIn } from "../anim";
import { LIGHT_PALETTE } from "../brand/palette";
import { Stage } from "../primitives/Stage";
import { Avatar, Bar, Card, CheckMark, Chip } from "../primitives/shapes";

/**
 * The marketplace hero clip: describe a need, a consultant scopes it.
 *
 * It animates the exact sentence the band beside it makes — "describe what you
 * need and a vetted consultant will scope it — roadmap, deliverables and terms
 * before any work starts". The three chips in beat 3 ARE that list, in that
 * order, so the picture cannot drift from the promise.
 *
 * NO CAPTIONS, unlike the three 16:9 clips. This one renders into a ~340px
 * column, where the 64px caption line would land at ~18px and the four-beat
 * caption track would crowd a 4:3 tile. The 70% of the band next to it is the
 * words; this is only the demonstration.
 *
 * Message content is BARS, never prose, for the same reason: at 28% scale any
 * real sentence is a grey smear, and a bar is honest about being a placeholder
 * where a fake sentence would not be.
 *
 * LIGHT, and deliberately so: the tile sits on `bg-primary`, and a navy panel
 * there would fight the band. White reads as the product surface the band is
 * talking about. See MarketplaceHero.tsx for why it is a bordered tile rather
 * than a bleed — a baked MP4 cannot follow `--primary` across themes.
 */

/** Straight out of the hero's own sentence, in its order. */
const SCOPED = ["Roadmap", "Deliverables", "Terms"] as const;

const PILL = { x: 70, y: 752, w: 1060, h: 96 } as const;
const ASK = { x: 430, y: 96, w: 700, h: 150 } as const;
const REPLY = { x: 172, y: 300, w: 800, h: 178 } as const;

export const HeroStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const PALETTE = LIGHT_PALETTE;

	// Everything is torn down before the loop point, so the last frames and the
	// first frames are the same bare input and the cut is invisible.
	const out = lerp(frame, [296, 316], [1, 0], EASE_OUT);

	// ── Beat 1: the need, typed into the box, then sent.
	const typed = lerp(frame, [10, 44], [0, 1], EASE_OUT);
	// The box empties as the message leaves it.
	const inBox = lerp(frame, [46, 54], [1, 0]);
	const askIn = springIn(frame, fps, 48, 26);
	const askOut = lerp(frame, [292, 306], [1, 0], EASE_OUT);

	// ── Beat 2: the consultant reads it and answers.
	const dots = Math.min(
		lerp(frame, [88, 100], [0, 1]),
		lerp(frame, [118, 128], [1, 0]),
	);
	const replyIn = springIn(frame, fps, 118, 26);
	// The reply gives way to the structure it produced.
	const replyOut = lerp(frame, [172, 186], [1, 0], EASE_OUT);

	// ── Beat 4: scoped.
	const scopedOut = lerp(frame, [290, 304], [1, 0], EASE_OUT);

	return (
		<Stage palette={PALETTE}>
			<div style={{ opacity: out }}>
				{/* ---------- What was asked ---------- */}
				<div style={{ opacity: askIn * askOut }}>
					<Card
						x={ASK.x}
						y={ASK.y}
						w={ASK.w}
						h={ASK.h}
						radius={32}
						tone="primary"
						scale={0.94 + 0.06 * askIn}
					/>
					<Bar
						x={ASK.x + 44}
						y={ASK.y + 48}
						w={560}
						h={16}
						tone="onPrimary"
						opacity={0.92}
					/>
					<Bar
						x={ASK.x + 44}
						y={ASK.y + 90}
						w={400}
						h={16}
						tone="onPrimary"
						opacity={0.6}
					/>
				</div>

				{/* ---------- Who is answering ---------- */}
				<div style={{ opacity: Math.min(springIn(frame, fps, 84, 22), replyOut) }}>
					<Avatar x={62} y={318} size={86} variant={0} />
				</div>

				{/* The pause before an answer — three dots, then the reply. */}
				<div style={{ opacity: dots }}>
					{[0, 1, 2].map((i) => (
						<div
							key={i}
							style={{
								position: "absolute",
								left: 190 + i * 40,
								top: 350,
								width: 22,
								height: 22,
								borderRadius: 11,
								backgroundColor: PALETTE.bar,
								opacity: lerp(
									(frame - 88 - i * 5) % 24,
									[0, 12],
									[0.35, 1],
								),
							}}
						/>
					))}
				</div>

				{/* ---------- The answer ---------- */}
				<div style={{ opacity: replyIn * replyOut }}>
					<Card
						x={REPLY.x}
						y={REPLY.y}
						w={REPLY.w}
						h={REPLY.h}
						radius={32}
						tone="surface"
						scale={0.94 + 0.06 * replyIn}
					/>
					{[620, 700, 480].map((w, i) => (
						<Bar
							key={w}
							x={REPLY.x + 44}
							y={REPLY.y + 46 + i * 44}
							w={w}
							h={14}
							reveal={lerp(frame, [126 + i * 10, 150 + i * 10], [0, 1])}
						/>
					))}
				</div>

				{/* ---------- What the answer became ---------- */}
				<div style={{ opacity: scopedOut }}>
					{SCOPED.map((label, i) => {
						const t = springIn(frame, fps, 182 + i * 12, 26);
						return (
							<div key={label} style={{ opacity: t }}>
								<Card
									x={172}
									y={296 + i * 96}
									w={800}
									h={78}
									radius={20}
									tone="surfaceHi"
									scale={0.94 + 0.06 * t}
								/>
								<Chip x={196} y={313 + i * 96} label={label} tone="muted" />
								<CheckMark
									x={880}
									y={314 + i * 96}
									size={44}
									progress={lerp(
										frame,
										[196 + i * 12, 218 + i * 12],
										[0, 1],
										EASE_OUT,
									)}
								/>
							</div>
						);
					})}

					{/* The state it lands in, before any work starts. */}
					<div style={{ opacity: springIn(frame, fps, 240, 24) }}>
						<Chip x={172} y={604} label="Scoped" tone="primary" />
					</div>
				</div>

				{/* ---------- The box it all started in ---------- */}
				<Card
					x={PILL.x}
					y={PILL.y}
					w={PILL.w}
					h={PILL.h}
					radius={48}
					tone="surfaceHi"
				/>
				<Bar
					x={PILL.x + 48}
					y={PILL.y + 41}
					w={560}
					h={14}
					reveal={typed}
					opacity={inBox}
				/>
				{/* The send affordance, primary because it is the band's own button. */}
				<Card
					x={PILL.x + PILL.w - 168}
					y={PILL.y + 16}
					w={152}
					h={64}
					radius={32}
					tone="primary"
				/>
				<Bar
					x={PILL.x + PILL.w - 132}
					y={PILL.y + 42}
					w={80}
					h={12}
					tone="onPrimary"
					opacity={0.92}
				/>
			</div>
		</Stage>
	);
};

/** Rendered inside AbsoluteFill so the stage is exactly HERO_STAGE. */
export const HeroStage: React.FC = () => (
	<AbsoluteFill>
		<HeroStory />
	</AbsoluteFill>
);
