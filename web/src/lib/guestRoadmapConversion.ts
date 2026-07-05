import { getGuestSessionId } from "@/lib/guestAuth";

export const GUEST_ROADMAP_KEY = "proyekto_guest_roadmap";
export const PENDING_PROJECT_FROM_ROADMAP_KEY =
	"proyekto_pending_project_from_roadmap";
const GUEST_ROADMAP_CTA_DISMISSED_KEY_PREFIX =
	"proyekto_guest_roadmap_cta_dismissed:";

export interface GuestRoadmapMetadata {
	roadmapId: string;
	title: string;
	createdAt: string;
	lastViewed: string;
}

export interface PendingProjectFromRoadmap {
	roadmapId: string;
	title?: string;
	guestSessionId?: string | null;
	createdAt: string;
	source: "roadmap_cta" | "recovery_modal";
}

function readJson<T>(key: string): T | null {
	if (typeof window === "undefined") return null;
	try {
		const stored = localStorage.getItem(key);
		return stored ? (JSON.parse(stored) as T) : null;
	} catch {
		localStorage.removeItem(key);
		return null;
	}
}

function writeJson(key: string, value: unknown): void {
	if (typeof window === "undefined") return;
	localStorage.setItem(key, JSON.stringify(value));
}

export function getGuestRoadmapMetadata(): GuestRoadmapMetadata | null {
	return readJson<GuestRoadmapMetadata>(GUEST_ROADMAP_KEY);
}

export function rememberGuestRoadmap({
	roadmapId,
	title,
}: {
	roadmapId: string;
	title: string;
}): GuestRoadmapMetadata {
	const now = new Date().toISOString();
	const existing = getGuestRoadmapMetadata();
	const metadata: GuestRoadmapMetadata = {
		roadmapId,
		title,
		createdAt: existing?.roadmapId === roadmapId ? existing.createdAt : now,
		lastViewed: now,
	};
	writeJson(GUEST_ROADMAP_KEY, metadata);
	return metadata;
}

export function clearGuestRoadmapMetadata(roadmapId?: string): void {
	if (typeof window === "undefined") return;
	const existing = getGuestRoadmapMetadata();
	if (!roadmapId || existing?.roadmapId === roadmapId) {
		localStorage.removeItem(GUEST_ROADMAP_KEY);
	}
}

export function getPendingProjectFromRoadmap(): PendingProjectFromRoadmap | null {
	return readJson<PendingProjectFromRoadmap>(PENDING_PROJECT_FROM_ROADMAP_KEY);
}

export function setPendingProjectFromRoadmap({
	roadmapId,
	title,
	source = "roadmap_cta",
}: {
	roadmapId: string;
	title?: string;
	source?: PendingProjectFromRoadmap["source"];
}): PendingProjectFromRoadmap {
	const pending: PendingProjectFromRoadmap = {
		roadmapId,
		title,
		guestSessionId: getGuestSessionId(),
		createdAt: new Date().toISOString(),
		source,
	};
	writeJson(PENDING_PROJECT_FROM_ROADMAP_KEY, pending);
	return pending;
}

export function clearPendingProjectFromRoadmap(roadmapId?: string): void {
	if (typeof window === "undefined") return;
	const existing = getPendingProjectFromRoadmap();
	if (!roadmapId || existing?.roadmapId === roadmapId) {
		localStorage.removeItem(PENDING_PROJECT_FROM_ROADMAP_KEY);
	}
}

export function hasPendingProjectFromRoadmapIntent(): boolean {
	return Boolean(getPendingProjectFromRoadmap()?.roadmapId);
}

function getGuestRoadmapCtaDismissedKey(roadmapId: string): string {
	return `${GUEST_ROADMAP_CTA_DISMISSED_KEY_PREFIX}${roadmapId}`;
}

export function isGuestRoadmapCtaDismissed(roadmapId: string): boolean {
	if (typeof window === "undefined") return false;
	return (
		localStorage.getItem(getGuestRoadmapCtaDismissedKey(roadmapId)) === "1"
	);
}

export function dismissGuestRoadmapCta(roadmapId: string): void {
	if (typeof window === "undefined") return;
	localStorage.setItem(getGuestRoadmapCtaDismissedKey(roadmapId), "1");
}

export function restoreGuestRoadmapCta(roadmapId: string): void {
	if (typeof window === "undefined") return;
	localStorage.removeItem(getGuestRoadmapCtaDismissedKey(roadmapId));
}
