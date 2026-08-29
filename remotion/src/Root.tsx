import type React from "react";
import { Composition } from "remotion";
import "./index.css";
import { DURATION, FPS, HERO_STAGE, STAGE } from "./brand/timing";
import { ConsultantStage } from "./stories/ConsultantStory";
import { HeroConsultantStage } from "./stories/HeroConsultantStory";
import { HeroStage } from "./stories/HeroStory";
import { HeroTemplateStage } from "./stories/HeroTemplateStory";
import { McpStage } from "./stories/McpStory";
import { TalentStage } from "./stories/TalentStory";

/**
 * The explainer videos: two for `/start-selling`, one for the MCP Access
 * settings page, and the 4:3 tile in the marketplace hero band.
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
				id="HeroStory"
				component={HeroStage}
				durationInFrames={DURATION}
				fps={FPS}
				width={HERO_STAGE.w}
				height={HERO_STAGE.h}
			/>
			<Composition
				id="HeroConsultantStory"
				component={HeroConsultantStage}
				durationInFrames={DURATION}
				fps={FPS}
				width={HERO_STAGE.w}
				height={HERO_STAGE.h}
			/>
			<Composition
				id="HeroTemplateStory"
				component={HeroTemplateStage}
				durationInFrames={DURATION}
				fps={FPS}
				width={HERO_STAGE.w}
				height={HERO_STAGE.h}
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
