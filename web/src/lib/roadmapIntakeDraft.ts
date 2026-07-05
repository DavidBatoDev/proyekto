export type RoadmapIntakeSource = "hero" | "dashboard" | "project";

export interface RoadmapIntakeDraft {
	prompt: string;
	source: RoadmapIntakeSource;
	projectId?: string;
	createdAt: string;
}

const ROADMAP_INTAKE_DRAFT_KEY_PREFIX = "proyekto_roadmap_intake:";
const ROADMAP_INTAKE_DRAFT_TTL_MS = 1000 * 60 * 60 * 24;

function createDraftId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getDraftKey(draftId: string): string {
	return `${ROADMAP_INTAKE_DRAFT_KEY_PREFIX}${draftId}`;
}

export function createRoadmapIntakeDraft({
	prompt,
	source,
	projectId,
}: {
	prompt: string;
	source: RoadmapIntakeSource;
	projectId?: string;
}): string {
	const draftId = createDraftId();
	const draft: RoadmapIntakeDraft = {
		prompt,
		source,
		projectId,
		createdAt: new Date().toISOString(),
	};

	try {
		window.sessionStorage.setItem(getDraftKey(draftId), JSON.stringify(draft));
	} catch {
		// The create page can still ask for the idea manually if storage is blocked.
	}

	return draftId;
}

export function readRoadmapIntakeDraft(
	draftId?: string,
): RoadmapIntakeDraft | null {
	if (!draftId) return null;

	try {
		const raw = window.sessionStorage.getItem(getDraftKey(draftId));
		if (!raw) return null;

		const parsed = JSON.parse(raw) as Partial<RoadmapIntakeDraft>;
		if (typeof parsed.prompt !== "string") return null;

		const createdAt = parsed.createdAt ? Date.parse(parsed.createdAt) : NaN;
		if (!Number.isFinite(createdAt)) return null;
		if (Date.now() - createdAt > ROADMAP_INTAKE_DRAFT_TTL_MS) {
			clearRoadmapIntakeDraft(draftId);
			return null;
		}

		return {
			prompt: parsed.prompt,
			source: parsed.source ?? "dashboard",
			projectId: parsed.projectId,
			createdAt: parsed.createdAt ?? new Date().toISOString(),
		};
	} catch {
		return null;
	}
}

export function clearRoadmapIntakeDraft(draftId?: string): void {
	if (!draftId) return;
	try {
		window.sessionStorage.removeItem(getDraftKey(draftId));
	} catch {
		// Non-critical cleanup.
	}
}
