import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_OUT, lerp, springIn } from "../anim";
import { LIGHT_PALETTE } from "../brand/palette";
import { Stage } from "../primitives/Stage";
import { Avatar, Bar, Card, CheckMark, Chip } from "../primitives/shapes";

/**
 * Hero carousel slide 2: a vetted lead takes the project.
 *
 * Same 4:3 light tile as `HeroStory` — see that file for why this family has no
 * captions and uses bars rather than prose.
 *
 * The three candidates carry no names, ratings or counts. A rating baked into a
 * marketing loop would be a number the viewer remembers and the product never
 * promised; `WhyLeadOnProyekto` and the consultant directory both decline to
 * state one, so this does too. "Vetted" is the only claim, and it is the word
 * the page itself uses.
 */

const ROWS = [0, 1, 2] as const;
/** The one that gets picked. */
const CHOSEN = 1;

export const HeroConsultantStory: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const PALETTE = LIGHT_PALETTE;

	const out = lerp(frame, [296, 316], [1, 0], EASE_OUT);
	// The two that are not picked step back rather than vanish — they are still
	// the bench, which is the point of a directory.
	const others = lerp(frame, [104, 126], [1, 0.32], EASE_OUT);
	// The chosen card rises to the top and the work appears beneath it.
	const lift = lerp(frame, [168, 196], [0, 1], EASE_OUT);

	return (
		<Stage palette={PALETTE}>
			<div style={{ opacity: out }}>
				{ROWS.map((i) => {
					const isChosen = i === CHOSEN;
					const enter = springIn(frame, fps, 10 + i * 12, 26);
					// Only the chosen row survives into the second half.
					const alive = isChosen
						? 1
						: Math.min(others, lerp(frame, [166, 186], [1, 0], EASE_OUT));
					const y = isChosen
						? lerp(lift, [0, 1], [96 + i * 172, 92])
						: 96 + i * 172;
					const pick = isChosen ? springIn(frame, fps, 104, 24) : 0;

					return (
						<div key={i} style={{ opacity: enter * alive }}>
							<Card
								x={96}
								y={y}
								w={1008}
								h={148}
								radius={28}
								tone={isChosen ? "surfaceHi" : "surface"}
								scale={(0.94 + 0.06 * enter) * (1 + 0.02 * pick)}
								borderColor={pick > 0.4 ? PALETTE.blue500 : undefined}
								glow={0.5 * pick}
							/>
							<Avatar x={136} y={y + 30} size={88} variant={i as 0 | 1 | 2} />
							<Bar x={256} y={y + 46} w={[300, 360, 270][i]} h={16} tone="ink" opacity={0.75} />
							<Bar x={256} y={y + 84} w={[420, 470, 380][i]} h={12} />
							<CheckMark
								x={984}
								y={y + 52}
								size={44}
								progress={lerp(frame, [40 + i * 12, 64 + i * 12], [0, 1], EASE_OUT)}
							/>
						</div>
					);
				})}

				{/* The only claim this slide makes. */}
				<div style={{ opacity: springIn(frame, fps, 116, 22) }}>
					<Chip
						x={136}
						y={lerp(lift, [0, 1], [96 + CHOSEN * 172, 92]) + 160}
						label="Vetted"
						tone="primary"
					/>
				</div>

				{/* What they then lead. */}
				{[0, 1, 2].map((i) => {
					const t = springIn(frame, fps, 206 + i * 14, 26);
					return (
						<div key={`task-${i}`} style={{ opacity: t }}>
							<Card
								x={168}
								y={392 + i * 118}
								w={936}
								h={84}
								radius={20}
								tone="surface"
								scale={0.94 + 0.06 * t}
							/>
							<Bar x={208} y={426 + i * 118} w={[380, 300, 340][i]} h={14} />
							<CheckMark
								x={1012}
								y={414 + i * 118}
								size={44}
								progress={lerp(
									frame,
									[244 + i * 14, 268 + i * 14],
									[0, 1],
									EASE_OUT,
								)}
							/>
						</div>
					);
				})}
			</div>
		</Stage>
	);
};

/** Rendered inside AbsoluteFill so the stage is exactly HERO_STAGE. */
export const HeroConsultantStage: React.FC = () => (
	<AbsoluteFill>
		<HeroConsultantStory />
	</AbsoluteFill>
);
