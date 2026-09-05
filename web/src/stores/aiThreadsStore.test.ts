/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

const NEW_KEY = "ai.threads.v1";
const LEGACY_KEY = "roadmap.ai.threads.v1";

function legacyDocument() {
	return JSON.stringify({
		state: {
			activeThreadIdByRoadmap: {
				"rm-1": "thread-a",
				"rm-2": null,
			},
			draftInputByThread: {
				"thread-a": "unsent text",
			},
		},
		version: 0,
	});
}

async function loadStore() {
	vi.resetModules();
	return import("./aiThreadsStore");
}

describe("aiThreadsStore legacy migration", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("migrates roadmap.ai.threads.v1 into ai.threads.v1 with scope keys", async () => {
		window.localStorage.setItem(LEGACY_KEY, legacyDocument());

		const { migrateLegacyAiThreadsStorage } = await loadStore();
		// The module already ran the migration at import time; a second call is
		// a no-op because the new key now exists.
		expect(migrateLegacyAiThreadsStorage()).toBe(false);

		const raw = window.localStorage.getItem(NEW_KEY);
		expect(raw).not.toBeNull();
		const parsed = JSON.parse(raw as string) as {
			state: Record<string, unknown>;
			version: number;
		};
		expect(parsed.version).toBe(0);
		expect(parsed.state.activeThreadIdByScope).toEqual({
			"roadmap:rm-1": "thread-a",
			"roadmap:rm-2": null,
		});
		expect(parsed.state.draftInputByThread).toEqual({
			"thread-a": "unsent text",
		});
		expect(parsed.state.draftPicksByThread).toEqual({});
		expect(parsed.state.draftAutoExcludedByThread).toEqual({});
		expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
	});

	it("hydrates the store from the migrated document", async () => {
		window.localStorage.setItem(LEGACY_KEY, legacyDocument());

		const { useAiThreadsStore } = await loadStore();
		const state = useAiThreadsStore.getState();
		expect(state.activeThreadIdByScope["roadmap:rm-1"]).toBe("thread-a");
		expect(state.draftInputByThread["thread-a"]).toBe("unsent text");
		expect(state.draftPicksByThread).toEqual({});
		expect(state.draftAutoExcludedByThread).toEqual({});
	});

	it("hydrates a pre-chips document without the exclusions record", async () => {
		window.localStorage.setItem(
			NEW_KEY,
			JSON.stringify({
				state: {
					activeThreadIdByScope: { "roadmap:rm-1": "t1" },
					draftInputByThread: { t1: "draft" },
					draftPicksByThread: {},
				},
				version: 0,
			}),
		);
		const { useAiThreadsStore } = await loadStore();
		const state = useAiThreadsStore.getState();
		expect(state.draftInputByThread.t1).toBe("draft");
		expect(state.draftAutoExcludedByThread).toEqual({});
		state.excludeAutoRef("t1", "project:p1");
		expect(useAiThreadsStore.getState().draftAutoExcludedByThread).toEqual({
			t1: ["project:p1"],
		});
	});

	it("never overwrites an existing ai.threads.v1 document", async () => {
		const existing = JSON.stringify({
			state: {
				activeThreadIdByScope: { "workspace:ws-1": "thread-w" },
				draftInputByThread: {},
				draftPicksByThread: {},
			},
			version: 0,
		});
		window.localStorage.setItem(NEW_KEY, existing);
		window.localStorage.setItem(LEGACY_KEY, legacyDocument());

		const { useAiThreadsStore } = await loadStore();
		expect(window.localStorage.getItem(NEW_KEY)).toBe(existing);
		// The legacy key is left alone too: nothing was migrated.
		expect(window.localStorage.getItem(LEGACY_KEY)).toBe(legacyDocument());
		expect(
			useAiThreadsStore.getState().activeThreadIdByScope["roadmap:rm-1"],
		).toBeUndefined();
	});

	it("is a no-op without a legacy document", async () => {
		const { migrateLegacyAiThreadsStorage } = await loadStore();
		expect(migrateLegacyAiThreadsStorage()).toBe(false);
		expect(window.localStorage.getItem(NEW_KEY)).toBeNull();
	});

	it("survives a corrupt legacy document and blocked storage", async () => {
		window.localStorage.setItem(LEGACY_KEY, "{not json");
		const { migrateLegacyAiThreadsStorage } = await loadStore();
		expect(window.localStorage.getItem(NEW_KEY)).toBeNull();

		const throwing = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
			removeItem: () => {
				throw new Error("blocked");
			},
		};
		expect(migrateLegacyAiThreadsStorage(throwing)).toBe(false);
	});

	it("drops non-string draft values and non-string thread ids", () => {
		const store = new Map<string, string>();
		const storage = {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => {
				store.set(key, value);
			},
			removeItem: (key: string) => {
				store.delete(key);
			},
		};
		store.set(
			LEGACY_KEY,
			JSON.stringify({
				state: {
					activeThreadIdByRoadmap: { "rm-1": 42, "rm-2": "thread-b" },
					draftInputByThread: { "thread-b": 7, "thread-c": "ok" },
				},
			}),
		);
		return loadStore().then(({ migrateLegacyAiThreadsStorage }) => {
			expect(migrateLegacyAiThreadsStorage(storage)).toBe(true);
			const parsed = JSON.parse(store.get(NEW_KEY) as string) as {
				state: {
					activeThreadIdByScope: Record<string, string | null>;
					draftInputByThread: Record<string, string>;
				};
			};
			expect(parsed.state.activeThreadIdByScope).toEqual({
				"roadmap:rm-1": null,
				"roadmap:rm-2": "thread-b",
			});
			expect(parsed.state.draftInputByThread).toEqual({ "thread-c": "ok" });
			expect(store.has(LEGACY_KEY)).toBe(false);
		});
	});
});

describe("aiThreadsStore actions", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("tracks the active thread per scope key", async () => {
		const { useAiThreadsStore } = await loadStore();
		const { setActiveThread, clearScopeState } = useAiThreadsStore.getState();
		setActiveThread("roadmap:rm-1", "t1");
		setActiveThread("workspace:ws-1", "t2");
		expect(useAiThreadsStore.getState().activeThreadIdByScope).toEqual({
			"roadmap:rm-1": "t1",
			"workspace:ws-1": "t2",
		});
		clearScopeState("roadmap:rm-1");
		expect(useAiThreadsStore.getState().activeThreadIdByScope).toEqual({
			"workspace:ws-1": "t2",
		});
	});

	it("stores drafts with picks and clears both together", async () => {
		const { useAiThreadsStore } = await loadStore();
		const { setDraft, clearDraft } = useAiThreadsStore.getState();
		setDraft("t1", "hello @Onboarding", [
			{ kind: "roadmap", id: "rm-1", label: "Onboarding" },
		]);
		expect(useAiThreadsStore.getState().draftInputByThread.t1).toBe(
			"hello @Onboarding",
		);
		expect(useAiThreadsStore.getState().draftPicksByThread.t1).toEqual([
			{ kind: "roadmap", id: "rm-1", label: "Onboarding" },
		]);

		// Omitting picks keeps the previous ones.
		setDraft("t1", "hello @Onboarding!");
		expect(useAiThreadsStore.getState().draftPicksByThread.t1).toHaveLength(1);

		clearDraft("t1");
		expect(useAiThreadsStore.getState().draftInputByThread).toEqual({});
		expect(useAiThreadsStore.getState().draftPicksByThread).toEqual({});
	});

	it("excludes auto refs per thread (deduped) and clears them with the draft", async () => {
		const { useAiThreadsStore } = await loadStore();
		const { excludeAutoRef, setDraft, clearDraft } =
			useAiThreadsStore.getState();
		const before = useAiThreadsStore.getState();
		excludeAutoRef("t1", "project:p1");
		excludeAutoRef("t1", "project:p1");
		excludeAutoRef("t1", "roadmap:r1");
		excludeAutoRef("t2", "roadmap:r1");
		expect(useAiThreadsStore.getState().draftAutoExcludedByThread).toEqual({
			t1: ["project:p1", "roadmap:r1"],
			t2: ["roadmap:r1"],
		});
		// Repeating a key is a no-op (same state object).
		const snapshot = useAiThreadsStore.getState();
		excludeAutoRef("t1", "project:p1");
		expect(useAiThreadsStore.getState()).toBe(snapshot);
		expect(before).not.toBe(snapshot);

		// Editing the draft keeps the exclusions; other threads are untouched.
		setDraft("t1", "typing", []);
		expect(useAiThreadsStore.getState().draftAutoExcludedByThread.t1).toEqual([
			"project:p1",
			"roadmap:r1",
		]);

		clearDraft("t1");
		expect(useAiThreadsStore.getState().draftAutoExcludedByThread).toEqual({
			t2: ["roadmap:r1"],
		});
		expect(useAiThreadsStore.getState().draftInputByThread).toEqual({});
		// A thread with only exclusions is still cleared.
		clearDraft("t2");
		expect(useAiThreadsStore.getState().draftAutoExcludedByThread).toEqual({});
	});

	it("persists the four records under ai.threads.v1", async () => {
		const { useAiThreadsStore } = await loadStore();
		useAiThreadsStore.getState().setActiveThread("workspace:ws-1", "t9");
		useAiThreadsStore.getState().setDraft("t9", "draft", []);
		useAiThreadsStore.getState().excludeAutoRef("t9", "project:p1");
		const parsed = JSON.parse(
			window.localStorage.getItem(NEW_KEY) as string,
		) as { state: Record<string, unknown> };
		expect(Object.keys(parsed.state).sort()).toEqual([
			"activeThreadIdByScope",
			"draftAutoExcludedByThread",
			"draftInputByThread",
			"draftPicksByThread",
		]);
		expect(parsed.state.activeThreadIdByScope).toEqual({
			"workspace:ws-1": "t9",
		});
		expect(parsed.state.draftAutoExcludedByThread).toEqual({
			t9: ["project:p1"],
		});
	});
});
