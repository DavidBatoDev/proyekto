import type { ComponentProps } from "react";
import { RoadmapTopBar } from "./RoadmapTopBar";

type RoadmapCanvasHeaderProps = ComponentProps<typeof RoadmapTopBar>;

export function RoadmapCanvasHeader(props: RoadmapCanvasHeaderProps) {
	return <RoadmapTopBar {...props} />;
}
