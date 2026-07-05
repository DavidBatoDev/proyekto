import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearRoadmapIntakeDraft,
	createRoadmapIntakeDraft,
	readRoadmapIntakeDraft,
} from "./roadmapIntakeDraft";

beforeEach(() => {
	vi.restoreAllMocks();
	const store = new Map<string, string>();
	Object.defineProperty(globalThis, "window", {
		value: {
			sessionStorage: {
				getItem: vi.fn((key: string) => store.get(key) ?? null),
				setItem: vi.fn((key: string, value: string) => {
					store.set(key, value);
				}),
				removeItem: vi.fn((key: string) => {
					store.delete(key);
				}),
				clear: vi.fn(() => store.clear()),
			},
		},
		configurable: true,
	});
});

describe("roadmapIntakeDraft", () => {
	it("stores and reads a roadmap setup draft", () => {
		const draftId = createRoadmapIntakeDraft({
			prompt: "Build a booking app",
			source: "hero",
			projectId: "n",
		});

		expect(readRoadmapIntakeDraft(draftId)).toMatchObject({
			prompt: "Build a booking app",
			source: "hero",
			projectId: "n",
		});
	});

	it("clears a draft", () => {
		const draftId = createRoadmapIntakeDraft({
			prompt: "Build a booking app",
			source: "dashboard",
		});

		clearRoadmapIntakeDraft(draftId);

		expect(readRoadmapIntakeDraft(draftId)).toBeNull();
	});
});
