import type { RoadmapEpic } from "@/types/roadmap";
import type { CanvasEdge, CanvasNode, StructuralNodeData } from "./types";

// Custom layout configuration with centered epic positioning among features
export const getLayoutedElements = (
	nodes: CanvasNode<StructuralNodeData>[],
	edges: CanvasEdge[],
	epics: RoadmapEpic[],
	measuredHeights?: Map<string, number>,
) => {
	const epicNodes = nodes.filter((node) => node.type === "epicWidget");
	const featureNodes = nodes.filter((node) => node.type === "featureWidget");

	const EPIC_X = 100;
	const FEATURE_X_OFFSET = 650; // Distance from epic to feature column
	const NODE_WIDTH = 500; // Fixed width for all nodes to simplify layout calculations
	const BASE_EPIC_HEIGHT = 220; // Base height for epics without descriptions or features
	const MAX_EPIC_HEIGHT = 420; // Max height for epics to prevent excessively tall nodes
	const DESCRIPTION_LINE_HEIGHT = 16; // Estimated line height for descriptions to calculate node height based on content
	const DESCRIPTION_CHARS_PER_LINE = 80; // Estimated characters per line for description text to calculate node height
	const BASE_FEATURE_HEIGHT = 150; // Base height for features without descriptions or tasks
	const MAX_FEATURE_HEIGHT = 300; // Max height for features to prevent excessively tall nodes
	const FEATURE_DESCRIPTION_LINE_HEIGHT = 16; // Estimated line height for feature descriptions to calculate node height based on content
	const FEATURE_DESCRIPTION_CHARS_PER_LINE = 70; // Estimated characters per line for feature description text to calculate node height
	const BASE_FEATURE_SPACING = 80; // Fallback spacing
	const MIN_FEATURE_SPACING = 40; // Minimum spacing when there are many features with large descriptions
	const MAX_FEATURE_SPACING = 200; // Maximum spacing when there are few features with small descriptions to prevent excessive gaps
	const FEATURE_SPACING_SCALE = 0.35; // Multiplier applied to average feature height when computing spacing
	const FEATURE_SPACING_BASE = 40; // Flat offset added to scaled height to compute spacing
	const GROUP_GAP_MIN = 120; // Minimum vertical gap between epic groups
	const GROUP_GAP_SCALE = 0.3; // Fraction of groupHeight added as gap between epic groups
	const sortedEpics = [...epics].sort((a, b) => a.position - b.position);
	const featureNodeMap = new Map(featureNodes.map((node) => [node.id, node]));

	const positionedEpicNodes: CanvasNode<StructuralNodeData>[] = [];
	const positionedFeatureNodes: CanvasNode<StructuralNodeData>[] = [];

	let currentY = 100;

	sortedEpics.forEach((epic) => {
		const epicNode = epicNodes.find((node) => node.id === epic.id);
		if (!epicNode) return;

		const featureIds = (epic.features || [])
			.map((feature) => feature.id)
			.filter((id) => featureNodeMap.has(id));

		const featureCount = featureIds.length;
		const featureHeights = (epic.features || [])
			.filter((feature) => featureIds.includes(feature.id))
			.map((feature) => {
				// Prefer the card's real rendered height once Flow has measured it —
				// the estimate below is only a placeholder for the first paint,
				// before any node has mounted and reported its size.
				const measured = measuredHeights?.get(feature.id);
				if (measured != null) return measured;
				const featureDescriptionLength = feature.description?.length ?? 0;
				const featureEstimatedLines = Math.ceil(
					featureDescriptionLength / FEATURE_DESCRIPTION_CHARS_PER_LINE,
				);
				const featureEstimatedDescriptionHeight = Math.min(
					featureEstimatedLines * FEATURE_DESCRIPTION_LINE_HEIGHT,
					MAX_FEATURE_HEIGHT - BASE_FEATURE_HEIGHT,
				);
				return Math.min(
					MAX_FEATURE_HEIGHT,
					BASE_FEATURE_HEIGHT + featureEstimatedDescriptionHeight,
				);
			});
		const descriptionLength = epic.description?.length ?? 0;
		const estimatedDescriptionLines = Math.ceil(
			descriptionLength / DESCRIPTION_CHARS_PER_LINE,
		);
		const estimatedDescriptionHeight = Math.min(
			estimatedDescriptionLines * DESCRIPTION_LINE_HEIGHT,
			MAX_EPIC_HEIGHT - BASE_EPIC_HEIGHT,
		);
		const epicHeight =
			measuredHeights?.get(epic.id) ??
			Math.min(MAX_EPIC_HEIGHT, BASE_EPIC_HEIGHT + estimatedDescriptionHeight);
		const averageFeatureHeight =
			featureHeights.length > 0
				? featureHeights.reduce((sum, height) => sum + height, 0) /
					featureHeights.length
				: BASE_FEATURE_HEIGHT;
		const featureSpacing =
			featureCount > 1
				? Math.min(
						MAX_FEATURE_SPACING,
						Math.max(
							MIN_FEATURE_SPACING,
							Math.round(
								averageFeatureHeight * FEATURE_SPACING_SCALE +
									FEATURE_SPACING_BASE,
							),
						),
					)
				: 0;
		const totalFeatureHeight =
			featureCount > 0
				? featureHeights.reduce((sum, height) => sum + height, 0) +
					featureSpacing * (featureCount - 1)
				: 0;
		const groupHeight = Math.max(epicHeight, totalFeatureHeight);
		const groupGap = Math.max(
			GROUP_GAP_MIN,
			Math.round(groupHeight * GROUP_GAP_SCALE),
		);
		const epicCenterY = currentY + groupHeight / 2;
		const epicY = epicCenterY - epicHeight / 2;

		positionedEpicNodes.push({
			...epicNode,
			width: NODE_WIDTH,
			height: epicHeight,
			position: { x: EPIC_X, y: epicY },
		});

		if (featureCount > 0) {
			let featureTopY = epicCenterY - totalFeatureHeight / 2;
			featureIds.forEach((featureId, index) => {
				const featureNode = featureNodeMap.get(featureId);
				if (!featureNode) return;
				const height = featureHeights[index] ?? BASE_FEATURE_HEIGHT;
				positionedFeatureNodes.push({
					...featureNode,
					width: NODE_WIDTH,
					height,
					position: { x: EPIC_X + FEATURE_X_OFFSET, y: featureTopY },
				});
				featureTopY += height + featureSpacing;
			});
		}

		currentY += groupHeight + groupGap;
	});

	const positionedFeatureIds = new Set(
		positionedFeatureNodes.map((node) => node.id),
	);
	const orphanFeatureNodes = featureNodes.filter(
		(node) => !positionedFeatureIds.has(node.id),
	);

	orphanFeatureNodes.forEach((node) => {
		positionedFeatureNodes.push({
			...node,
			width: NODE_WIDTH,
			height: BASE_FEATURE_HEIGHT,
			position: { x: EPIC_X + FEATURE_X_OFFSET, y: currentY },
		});
		currentY += BASE_FEATURE_SPACING;
	});

	const allLayoutedNodes = [...positionedEpicNodes, ...positionedFeatureNodes];

	return { nodes: allLayoutedNodes, edges };
};
