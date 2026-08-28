import type React from "react";
import { Composition } from "remotion";
import "./index.css";
import { DURATION, FPS, STAGE } from "./brand/timing";
import { ConsultantStage } from "./stories/ConsultantStory";
import { McpStage } from "./stories/McpStory";
import { TalentStage } from "./stories/TalentStory";

/**
 * The explainer videos: two for `/start-selling`, one for the MCP Access
 * settings page.
 *
 * Posters are pulled straight off these compositions with
 * `remotion still <id> --frame=<POSTER_FRAME[…]>`; see brand/timing.ts for why
 * there is no separate `<Still>` composition.
 */
export const RemotionRoot: React.FC = () => {
	return (
		<>
			<Composition
				id="TalentStory"
				component={TalentStage}
				durationInFrames={DURATION}
				fps={FPS}
				width={STAGE.w}
				height={STAGE.h}
			/>
			<Composition
				id="ConsultantStory"
				component={ConsultantStage}
				durationInFrames={DURATION}
				fps={FPS}
				width={STAGE.w}
				height={STAGE.h}
			/>
			<Composition
				id="McpStory"
				component={McpStage}
				durationInFrames={DURATION}
				fps={FPS}
				width={STAGE.w}
				height={STAGE.h}
			/>
		</>
	);
};
