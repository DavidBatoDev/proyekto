import { getOrCreateGuestUser } from "@/lib/guestAuth";
import { rememberGuestRoadmap } from "@/lib/guestRoadmapConversion";
import {
	setPendingRoadmapAiPrompt,
	setPendingRoadmapMetadataModal,
} from "@/lib/roadmapPageHandoff";
import { generateRoadmapThumbnailDataUri } from "@/lib/roadmapThumbnail";
import {
	type CreateRoadmapDto,
	roadmapService,
	type SuggestedRoadmapMetadata,
} from "@/services/roadmap.service";
import type { Roadmap } from "@/types/roadmap";

export const ROADMAP_NAME_MAX_LENGTH = 60;
export const DEFAULT_ROADMAP_NAME = "New Roadmap";
export const DEFAULT_ROADMAP_CATEGORY = "Web Development";

export function deriveRoadmapNameFromPrompt(message: string): string {
	const collapsed = message.trim().replace(/\s+/g, " ");
	if (!collapsed) return DEFAULT_ROADMAP_NAME;
	if (collapsed.length <= ROADMAP_NAME_MAX_LENGTH) return collapsed;
	return `${collapsed.slice(0, ROADMAP_NAME_MAX_LENGTH).trimEnd()}...`;
}

export function inferRoadmapCategory(prompt: string): string {
	const lower = prompt.toLowerCase();
	if (/\b(mobile|ios|android)\b/.test(lower)) return "Mobile App";
	if (/\b(ai|ml|machine learning|automation|chatbot)\b/.test(lower)) {
		return "AI / ML";
	}
	if (/\b(shop|store|commerce|marketplace|checkout)\b/.test(lower)) {
		return "E-commerce";
	}
	if (/\b(marketing|campaign|brand|content)\b/.test(lower)) {
		return "Marketing";
	}
	if (/\b(saas|subscription|dashboard|platform)\b/.test(lower)) {
		return "SaaS";
	}
	if (/\b(fitness|workout|health|wellness)\b/.test(lower)) {
		return "Health & Fitness";
	}
	return DEFAULT_ROADMAP_CATEGORY;
}

export function buildFallbackRoadmapMetadata(
	prompt: string,
): SuggestedRoadmapMetadata {
	const normalizedPrompt = prompt.trim().replace(/\s+/g, " ");
	return {
		name: deriveRoadmapNameFromPrompt(normalizedPrompt),
		description: normalizedPrompt
			? `Roadmap for ${normalizedPrompt}.`
			: "A structured roadmap for turning an idea into an actionable plan.",
		category: inferRoadmapCategory(normalizedPrompt),
	};
}

export function buildRoadmapCreatePayload({
	metadata,
	projectId,
	previewUrl,
}: {
	metadata: SuggestedRoadmapMetadata;
	projectId?: string;
	previewUrl?: string;
}): CreateRoadmapDto {
	const name = metadata.name.trim() || DEFAULT_ROADMAP_NAME;
	const category = metadata.category.trim() || DEFAULT_ROADMAP_CATEGORY;
	const resolvedPreviewUrl =
		previewUrl || generateRoadmapThumbnailDataUri(`${category}:${name}`, name);
	const payload: CreateRoadmapDto = {
		name,
		description: metadata.description.trim(),
		category,
		status: "draft",
		settings: {},
		preview_url: resolvedPreviewUrl,
	};

	if (projectId && projectId !== "n") {
		payload.project_id = projectId;
	}

	return payload;
}

export async function suggestRoadmapMetadataWithFallback({
	prompt,
	projectId,
}: {
	prompt: string;
	projectId?: string;
}): Promise<SuggestedRoadmapMetadata> {
	const trimmedPrompt = prompt.trim();
	const fallback = buildFallbackRoadmapMetadata(trimmedPrompt);
	if (!trimmedPrompt) return fallback;

	try {
		const metadata = await roadmapService.suggestMetadata({
			prompt: trimmedPrompt,
			project_id: projectId && projectId !== "n" ? projectId : null,
		});
		return {
			name: metadata.name.trim() || fallback.name,
			description: metadata.description.trim() || fallback.description,
			category: metadata.category.trim() || fallback.category,
		};
	} catch (error) {
		console.error("[roadmapCreationFlow] Metadata suggestion failed", error);
		return fallback;
	}
}

export async function createRoadmapFromIdea({
	prompt,
	projectId = "n",
	isAuthenticated,
	openMetadataModal = true,
}: {
	prompt: string;
	projectId?: string;
	isAuthenticated: boolean;
	openMetadataModal?: boolean;
}): Promise<Roadmap> {
	const trimmedPrompt = prompt.trim();
	const metadata = await suggestRoadmapMetadataWithFallback({
		prompt: trimmedPrompt,
		projectId,
	});

	return createRoadmapFromMetadata({
		metadata,
		prompt: trimmedPrompt,
		projectId,
		isAuthenticated,
		openMetadataModal,
	});
}

export async function createRoadmapFromMetadata({
	metadata,
	prompt,
	projectId = "n",
	isAuthenticated,
	openMetadataModal = false,
	previewUrl,
}: {
	metadata: SuggestedRoadmapMetadata;
	prompt: string;
	projectId?: string;
	isAuthenticated: boolean;
	openMetadataModal?: boolean;
	previewUrl?: string;
}): Promise<Roadmap> {
	const trimmedPrompt = prompt.trim();

	if (!isAuthenticated) {
		const guestId = await getOrCreateGuestUser();
		if (!guestId) throw new Error("Failed to initialize guest session");
	}

	const roadmap = await roadmapService.create(
		buildRoadmapCreatePayload({ metadata, projectId, previewUrl }),
	);

	if (!isAuthenticated) {
		rememberGuestRoadmap({
			roadmapId: roadmap.id,
			title: metadata.name.trim() || DEFAULT_ROADMAP_NAME,
		});
	}

	if (trimmedPrompt) {
		setPendingRoadmapAiPrompt(
			roadmap.id,
			buildRoadmapPlanningPrompt({ metadata, prompt: trimmedPrompt }),
		);
	}
	if (openMetadataModal) {
		setPendingRoadmapMetadataModal(roadmap.id);
	}

	return roadmap;
}

export function buildRoadmapPlanningPrompt({
	metadata,
	prompt,
}: {
	metadata: SuggestedRoadmapMetadata;
	prompt: string;
}): string {
	return [
		`Roadmap title: ${metadata.name.trim() || DEFAULT_ROADMAP_NAME}`,
		metadata.description.trim()
			? `Roadmap goal/description: ${metadata.description.trim()}`
			: "",
		metadata.category.trim() ? `Categories: ${metadata.category.trim()}` : "",
		`Original idea: ${prompt.trim()}`,
		"",
		"Create the roadmap epics, features, and tasks from this context.",
	]
		.filter((line) => line !== "")
		.join("\n");
}
