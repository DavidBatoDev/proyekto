export const PENDING_AI_PROMPT_KEY_PREFIX = "proyekto_pending_ai_prompt:";
export const OPEN_ROADMAP_METADATA_MODAL_KEY_PREFIX =
	"proyekto_open_roadmap_metadata:";

export function setPendingRoadmapAiPrompt(
	roadmapId: string,
	prompt: string,
): void {
	const trimmedPrompt = prompt.trim();
	if (!roadmapId || !trimmedPrompt) return;
	try {
		window.sessionStorage.setItem(
			`${PENDING_AI_PROMPT_KEY_PREFIX}${roadmapId}`,
			trimmedPrompt,
		);
	} catch {
		// sessionStorage may be unavailable in privacy-restricted contexts.
	}
}

export function consumePendingRoadmapAiPrompt(
	roadmapId: string,
): string | null {
	if (!roadmapId) return null;
	try {
		const key = `${PENDING_AI_PROMPT_KEY_PREFIX}${roadmapId}`;
		const prompt = window.sessionStorage.getItem(key);
		if (prompt !== null) {
			window.sessionStorage.removeItem(key);
		}
		return prompt;
	} catch {
		return null;
	}
}

export function setPendingRoadmapMetadataModal(roadmapId: string): void {
	if (!roadmapId) return;
	try {
		window.sessionStorage.setItem(
			`${OPEN_ROADMAP_METADATA_MODAL_KEY_PREFIX}${roadmapId}`,
			"1",
		);
	} catch {
		// Non-critical nicety. The roadmap still opens if storage is blocked.
	}
}

export function consumePendingRoadmapMetadataModal(roadmapId: string): boolean {
	if (!roadmapId) return false;
	try {
		const key = `${OPEN_ROADMAP_METADATA_MODAL_KEY_PREFIX}${roadmapId}`;
		const shouldOpen = window.sessionStorage.getItem(key) === "1";
		if (shouldOpen) {
			window.sessionStorage.removeItem(key);
		}
		return shouldOpen;
	} catch {
		return false;
	}
}
