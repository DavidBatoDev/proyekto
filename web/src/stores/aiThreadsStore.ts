import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AiMentionPick } from "@/components/ai/types";

// =============================================================================
// Lightweight client-side state for the AI thread picker and composer, shared
// by the roadmap panel and the dashboard assistant.
//
// We only persist which thread is active per SCOPE (`roadmap:{id}` /
// `workspace:{id}`, see `aiScopeKey`) and the unsent draft (text + mention
// picks) per thread; everything else (thread list, messages, titles) is
// server state owned by React Query. localStorage (not sessionStorage) so the
// active thread survives a reload.
//
// The threads store is the single source of truth for drafts: the rail and
// the fullscreen dashboard panels are mounted at the same time on the same
// thread, so a component-local draft would diverge between them.
// =============================================================================

export const AI_THREADS_STORAGE_KEY = "ai.threads.v1";
/** Pre-kit key (`roadmapAiThreadsStore.ts`), migrated once on load. */
export const LEGACY_AI_THREADS_STORAGE_KEY = "roadmap.ai.threads.v1";

export interface AiThreadsPersistedState {
	activeThreadIdByScope: Record<string, string | null>;
	draftInputByThread: Record<string, string>;
	draftPicksByThread: Record<string, AiMentionPick[]>;
	/**
	 * Auto-attached context refs (`kind:id`) the user removed from the draft.
	 * Cleared with the draft, so the surface's auto chips come back on the
	 * next message.
	 */
	draftAutoExcludedByThread: Record<string, string[]>;
}

export interface AiThreadsState extends AiThreadsPersistedState {
	setActiveThread: (scopeKey: string, threadId: string | null) => void;
	/** Store the unsent draft; `picks` keeps the previous picks when omitted. */
	setDraft: (threadId: string, input: string, picks?: AiMentionPick[]) => void;
	/** Drop one auto-attached ref from the draft's context row (this message only). */
	excludeAutoRef: (threadId: string, key: string) => void;
	clearDraft: (threadId: string) => void;
	clearScopeState: (scopeKey: string) => void;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One-time migration of the roadmap-only store. Runs before `create()` so
 * `persist` hydrates from the migrated document; a no-op when the new key
 * already exists or the legacy key is absent. Every storage access is wrapped
 * because storage may be blocked (private mode, disabled cookies) — a failure
 * simply leaves the user with fresh state.
 *
 * Exported for tests; `storage` defaults to `localStorage`.
 */
export function migrateLegacyAiThreadsStorage(storage?: StorageLike): boolean {
	try {
		const target = storage ?? globalThis.localStorage;
		if (!target) return false;
		if (target.getItem(AI_THREADS_STORAGE_KEY) !== null) return false;
		const legacyRaw = target.getItem(LEGACY_AI_THREADS_STORAGE_KEY);
		if (legacyRaw === null) return false;

		const parsed: unknown = JSON.parse(legacyRaw);
		const legacyState =
			isRecord(parsed) && isRecord(parsed.state) ? parsed.state : {};
		const activeThreadIdByScope: Record<string, string | null> = {};
		if (isRecord(legacyState.activeThreadIdByRoadmap)) {
			for (const [roadmapId, threadId] of Object.entries(
				legacyState.activeThreadIdByRoadmap,
			)) {
				if (!roadmapId) continue;
				activeThreadIdByScope[`roadmap:${roadmapId}`] =
					typeof threadId === "string" ? threadId : null;
			}
		}
		const draftInputByThread: Record<string, string> = {};
		if (isRecord(legacyState.draftInputByThread)) {
			for (const [threadId, value] of Object.entries(
				legacyState.draftInputByThread,
			)) {
				if (typeof value === "string") draftInputByThread[threadId] = value;
			}
		}

		const migrated: AiThreadsPersistedState = {
			activeThreadIdByScope,
			draftInputByThread,
			draftPicksByThread: {},
			draftAutoExcludedByThread: {},
		};
		target.setItem(
			AI_THREADS_STORAGE_KEY,
			JSON.stringify({ state: migrated, version: 0 }),
		);
		target.removeItem(LEGACY_AI_THREADS_STORAGE_KEY);
		return true;
	} catch {
		return false;
	}
}

migrateLegacyAiThreadsStorage();

export const useAiThreadsStore = create<AiThreadsState>()(
	persist(
		(set) => ({
			activeThreadIdByScope: {},
			draftInputByThread: {},
			draftPicksByThread: {},
			draftAutoExcludedByThread: {},

			setActiveThread: (scopeKey, threadId) =>
				set((state) => ({
					activeThreadIdByScope: {
						...state.activeThreadIdByScope,
						[scopeKey]: threadId,
					},
				})),

			setDraft: (threadId, input, picks) =>
				set((state) => {
					const next: Partial<AiThreadsPersistedState> = {
						draftInputByThread: {
							...state.draftInputByThread,
							[threadId]: input,
						},
					};
					if (picks !== undefined) {
						next.draftPicksByThread = {
							...state.draftPicksByThread,
							[threadId]: picks,
						};
					}
					return next;
				}),

			excludeAutoRef: (threadId, key) =>
				set((state) => {
					const current = state.draftAutoExcludedByThread[threadId] ?? [];
					if (current.includes(key)) return state;
					return {
						draftAutoExcludedByThread: {
							...state.draftAutoExcludedByThread,
							[threadId]: [...current, key],
						},
					};
				}),

			clearDraft: (threadId) =>
				set((state) => {
					const hasInput = threadId in state.draftInputByThread;
					const hasPicks = threadId in state.draftPicksByThread;
					const hasExcluded = threadId in state.draftAutoExcludedByThread;
					if (!hasInput && !hasPicks && !hasExcluded) return state;
					const nextInput = { ...state.draftInputByThread };
					delete nextInput[threadId];
					const nextPicks = { ...state.draftPicksByThread };
					delete nextPicks[threadId];
					const nextExcluded = { ...state.draftAutoExcludedByThread };
					delete nextExcluded[threadId];
					return {
						draftInputByThread: nextInput,
						draftPicksByThread: nextPicks,
						draftAutoExcludedByThread: nextExcluded,
					};
				}),

			clearScopeState: (scopeKey) =>
				set((state) => {
					if (!(scopeKey in state.activeThreadIdByScope)) return state;
					const next = { ...state.activeThreadIdByScope };
					delete next[scopeKey];
					return { activeThreadIdByScope: next };
				}),
		}),
		{
			name: AI_THREADS_STORAGE_KEY,
			storage: createJSONStorage(() => localStorage),
			partialize: (state) => ({
				activeThreadIdByScope: state.activeThreadIdByScope,
				draftInputByThread: state.draftInputByThread,
				draftPicksByThread: state.draftPicksByThread,
				draftAutoExcludedByThread: state.draftAutoExcludedByThread,
			}),
		},
	),
);

const EMPTY_PICKS: AiMentionPick[] = [];
const EMPTY_KEYS: string[] = [];

export function useActiveAiThread(scopeKey: string | null): string | null {
	return useAiThreadsStore((s) =>
		scopeKey ? (s.activeThreadIdByScope[scopeKey] ?? null) : null,
	);
}

export function useAiDraftInput(threadId: string | null): string {
	return useAiThreadsStore((s) =>
		threadId ? (s.draftInputByThread[threadId] ?? "") : "",
	);
}

export function useAiDraftPicks(threadId: string | null): AiMentionPick[] {
	return useAiThreadsStore((s) =>
		threadId ? (s.draftPicksByThread[threadId] ?? EMPTY_PICKS) : EMPTY_PICKS,
	);
}

/** `kind:id` keys of the auto refs removed from this draft. */
export function useAiDraftAutoExcluded(threadId: string | null): string[] {
	return useAiThreadsStore((s) =>
		threadId
			? (s.draftAutoExcludedByThread[threadId] ?? EMPTY_KEYS)
			: EMPTY_KEYS,
	);
}
