import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_OUT, lerp, springIn } from "../anim";
import { LIGHT_PALETTE } from "../brand/palette";
import { Stage } from "../primitives/Stage";
import { Bar, Card, Chip, Connector } from "../primitives/shapes";

/**
 * Hero carousel slide 3: start from a template, get a roadmap.
 *
 * Same 4:3 light tile as `HeroStory`. The three tier labels are the real
 * roadmap vocabulary — epic, feature, task — which is what `/roadmap-templates`
 * actually expands into, and the same three words `ConsultantStory` uses.
 *
 * No template names and no counts: the catalogue is fetched live and a baked
 * title would be the one that got retired.
 */

const TILES = [0, 1, 2, 3] as const;
/** The one that opens. */
const CHOSEN = 1;

/** Epic at the top, two features under it — the shape a template expands to. */
const NODES = [
	{ label: "Epic", x: 120, y: 300, w: 420, h: 92 },
	{ label: "Feature", x: 640, y: 268, w: 440, h: 84 },
	{ label: "Feature", x: 640, y: 392, w: 440, h: 84 },
] as const;

export const HeroTemplateStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const PALETTE = LIGHT_PALETTE;

	const out = lerp(frame, [296, 316], [1, 0], EASE_OUT);
	// The grid steps back once one is opened; it does not disappear, because the
	// catalogue is still there behind the choice.
	const grid = lerp(frame, [128, 152], [1, 0], EASE_OUT);
	const open = springIn(frame, fps, 140, 30);

	return (
		<Stage palette={PALETTE}>
			<div style={{ opacity: out }}>
				{/* ---------- The catalogue ---------- */}
				<div style={{ opacity: grid }}>
					{TILES.map((i) => {
						const t = springIn(frame, fps, 12 + i * 10, 26);
						const col = i % 2;
						const row = Math.floor(i / 2);
						const picked = i === CHOSEN ? springIn(frame, fps, 108, 22) : 0;
						return (
							<div key={i} style={{ opacity: t }}>
								<Card
									x={112 + col * 512}
									y={150 + row * 300}
									w={464}
									h={252}
									radius={28}
									tone={i === CHOSEN ? "surfaceHi" : "surface"}
									scale={(0.94 + 0.06 * t) * (1 + 0.03 * picked)}
									borderColor={picked > 0.4 ? PALETTE.blue500 : undefined}
									glow={0.5 * picked}
								/>
								<Bar
									x={152 + col * 512}
									y={190 + row * 300}
									w={[240, 280, 210, 260][i]}
									h={16}
									tone="ink"
									opacity={0.7}
								/>
								{[0, 1, 2].map((line) => (
									<Bar
										key={line}
										x={152 + col * 512}
										y={234 + row * 300 + line * 32}
										w={[320, 264, 300][line]}
										h={12}
										reveal={lerp(
											frame,
											[26 + i * 10 + line * 6, 48 + i * 10 + line * 6],
											[0, 1],
										)}
									/>
								))}
							</div>
						);
					})}
				</div>

				{/* ---------- What it opens into ---------- */}
				<div style={{ opacity: open }}>
					<Connector
						d="M 540 346 C 590 346, 590 310, 640 310"
						progress={lerp(frame, [176, 198], [0, 1], EASE_OUT)}
					/>
					<Connector
						d="M 540 346 C 590 346, 590 434, 640 434"
						progress={lerp(frame, [186, 208], [0, 1], EASE_OUT)}
					/>

					{NODES.map((node, i) => {
						const t = springIn(frame, fps, 168 + i * 14, 26);
						return (
							<div key={node.label + String(i)} style={{ opacity: t }}>
								<Card
									x={node.x}
									y={node.y}
									w={node.w}
									h={node.h}
									radius={22}
									tone={i === 0 ? "primary" : "surfaceHi"}
									scale={0.92 + 0.08 * t}
								/>
								<Chip
									x={node.x + 26}
									y={node.y + node.h / 2 - 22}
									label={node.label}
									tone={i === 0 ? "primary" : "muted"}
								/>
							</div>
						);
					})}

					{/* The tasks the features break into. */}
					{[0, 1, 2].map((i) => {
						const t = springIn(frame, fps, 226 + i * 12, 24);
						return (
							<div key={`task-${i}`} style={{ opacity: t }}>
								<Card
									x={200}
									y={560 + i * 84}
									w={880}
									h={64}
									radius={18}
									tone="surface"
									scale={0.94 + 0.06 * t}
								/>
								<Chip x={228} y={571 + i * 84} label="Task" tone="muted" />
								<Bar x={420} y={586 + i * 84} w={[380, 300, 340][i]} h={12} />
							</div>
						);
					})}
				</div>
			</div>
		</Stage>
	);
};

/** Rendered inside AbsoluteFill so the stage is exactly HERO_STAGE. */
export const HeroTemplateStage: React.FC = () => (
	<AbsoluteFill>
		<HeroTemplateStory />
	</AbsoluteFill>
);
