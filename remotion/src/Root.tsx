import type React from "react";
import { Composition } from "remotion";
import "./index.css";
import { DURATION, FPS, HERO_STAGE, STAGE } from "./brand/timing";
import { BoardEmptyStage } from "./stories/BoardEmptyStory";
import { ConsultantStage } from "./stories/ConsultantStory";
import { DeliverableEmptyStage } from "./stories/DeliverableEmptyStory";
import { HeroConsultantStage } from "./stories/HeroConsultantStory";
import { HeroStage } from "./stories/HeroStory";
import { HeroTemplateStage } from "./stories/HeroTemplateStory";
import { McpStage } from "./stories/McpStory";
import { RoadmapEmptyStage } from "./stories/RoadmapEmptyStory";
import { TalentStage } from "./stories/TalentStory";
import { TimelineEmptyStage } from "./stories/TimelineEmptyStory";

/**
 * The explainer videos: two for `/start-selling`, one for the MCP Access
 * settings page, the 4:3 tiles in the marketplace hero band, and the four
 * project empty-state clips that stand in for a page that has no data yet.
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
			<Composition
				id="RoadmapEmptyStory"
				component={RoadmapEmptyStage}
				durationInFrames={DURATION}
				fps={FPS}
				width={STAGE.w}
				height={STAGE.h}
			/>
			<Composition
				id="BoardEmptyStory"
				component={BoardEmptyStage}
				durationInFrames={DURATION}
				fps={FPS}
				width={STAGE.w}
				height={STAGE.h}
			/>
			<Composition
				id="TimelineEmptyStory"
				component={TimelineEmptyStage}
				durationInFrames={DURATION}
				fps={FPS}
				width={STAGE.w}
				height={STAGE.h}
			/>
			<Composition
				id="DeliverableEmptyStory"
				component={DeliverableEmptyStage}
				durationInFrames={DURATION}
				fps={FPS}
				width={STAGE.w}
				height={STAGE.h}
			/>
		</>
	);
};
