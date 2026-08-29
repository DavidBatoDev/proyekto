import type React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { EASE_OUT, lerp } from "../anim";
import { FONT_BODY, FONT_DISPLAY } from "../brand/fonts";
import { usePalette } from "../brand/palette";
import { BEATS } from "../brand/timing";

export type CaptionItem = { eyebrow: string; line: string };

/**
 * One caption: an eyebrow that fades and a line that rises and wipes in.
 *
 * Set at 64px so it survives the embed — at the ~1100px the panel occupies on
 * a desktop page that renders around 37px, and around 20px at a 600px phone
 * width. Both readable; smaller would not be.
 */
const Caption: React.FC<CaptionItem & { duration: number }> = ({
	eyebrow,
	line,
	duration,
}) => {
	const frame = useCurrentFrame();
	const PALETTE = usePalette();

	const enter = lerp(frame, [0, 16], [0, 1], EASE_OUT);
	const exit = lerp(frame, [duration - 14, duration - 2], [1, 0], EASE_OUT);
	const opacity = Math.min(enter, exit);
	const rise = lerp(frame, [0, 18], [18, 0], EASE_OUT);

	return (
		<div style={{ position: "absolute", left: 120, top: 812, opacity }}>
			<div
				style={{
					fontFamily: FONT_BODY,
					fontSize: 26,
					fontWeight: 700,
					letterSpacing: "0.14em",
					textTransform: "uppercase",
					color: PALETTE.inkMuted,
				}}
			>
				{eyebrow}
			</div>
			<div
				style={{
					marginTop: 14,
					fontFamily: FONT_DISPLAY,
					fontSize: 64,
					fontWeight: 600,
					letterSpacing: "-0.015em",
					color: PALETTE.ink,
					transform: `translateY(${rise}px)`,
					// Wipes left→right in step with the rise.
					clipPath: `inset(0 ${lerp(frame, [2, 24], [100, 0], EASE_OUT)}% 0 0)`,
				}}
			>
				{line}
			</div>
		</div>
	);
};

/**
 * The four captions, each scoped to its beat.
 *
 * These live inside <Sequence>, which is exactly what Sequence is for — things
 * with a birth and a death. The continuously-morphing scene elements do NOT,
 * because inside a Sequence `useCurrentFrame()` returns a beat-local frame and
 * a cross-beat morph needs the global one.
 */
export const CaptionTrack: React.FC<{ items: readonly CaptionItem[] }> = ({
	items,
}) => {
	return (
		<>
			{items.map((item, i) => (
				<Sequence
					key={item.line}
					from={BEATS[i].from}
					durationInFrames={BEATS[i].duration}
					layout="none"
				>
					<Caption
						eyebrow={item.eyebrow}
						line={item.line}
						duration={BEATS[i].duration}
					/>
				</Sequence>
			))}
		</>
	);
};
