import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiResolvedEntity } from "@/services/ai-context.service";
import {
	aiEntityKeys,
	createEntityBatcher,
	invalidateAiEntities,
	traceEventsTouchEntities,
} from "./aiEntityResolver";
import type { AiMentionKind } from "./aiMentions";

type Ref = { kind: AiMentionKind; id: string };
const idOf = (index: number) =>
	`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const resolved = (ref: Ref): AiResolvedEntity => ({
	...ref,
	accessible: true,
	title: `Item ${ref.id}`,
});
const failed = (ref: Ref): AiResolvedEntity => ({
	...ref,
	accessible: false,
	error_code: "RESOLVE_FAILED",
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createEntityBatcher", () => {
	it("batches two loads into one request after the 30 ms window", async () => {
		const resolve = vi.fn(async (refs: Ref[]) => refs.map(resolved));
		const batcher = createEntityBatcher(resolve);
		const first = batcher.load("task", idOf(1));
		const second = batcher.load("epic", idOf(2));
		await vi.advanceTimersByTimeAsync(29);
		expect(resolve).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(resolve).toHaveBeenCalledExactlyOnceWith([
			{ kind: "task", id: idOf(1) },
			{ kind: "epic", id: idOf(2) },
		]);
		expect(await Promise.all([first, second])).toEqual([
			resolved({ kind: "task", id: idOf(1) }),
			resolved({ kind: "epic", id: idOf(2) }),
		]);
	});

	it("chunks 30 different entities into requests of 25 and 5", async () => {
		const resolve = vi.fn(async (refs: Ref[]) => refs.map(resolved));
		const batcher = createEntityBatcher(resolve);
		const pending = Array.from({ length: 30 }, (_, index) =>
			batcher.load("task", idOf(index)),
		);
		await vi.advanceTimersByTimeAsync(30);
		expect(resolve.mock.calls.map(([refs]) => refs.length)).toEqual([25, 5]);
		expect(await Promise.all(pending)).toHaveLength(30);
	});

	it("collapses duplicate keys and settles all their waiters", async () => {
		const resolve = vi.fn(async (refs: Ref[]) => refs.map(resolved));
		const batcher = createEntityBatcher(resolve);
		const pending = [
			batcher.load("task", idOf(1)),
			batcher.load("task", idOf(1)),
			batcher.load("epic", idOf(1)),
		];
		await vi.advanceTimersByTimeAsync(30);
		expect(resolve).toHaveBeenCalledExactlyOnceWith([
			{ kind: "task", id: idOf(1) },
			{ kind: "epic", id: idOf(1) },
		]);
		const results = await Promise.all(pending);
		expect(results[0]).toEqual(results[1]);
		expect(results[2].kind).toBe("epic");
	});

	it("settles every waiter as inaccessible when the batch is rejected", async () => {
		const resolve = vi.fn(async (): Promise<AiResolvedEntity[]> => {
			throw new Error("Request failed");
		});
		const batcher = createEntityBatcher(resolve);
		const pending = [
			batcher.load("task", idOf(1)),
			batcher.load("task", idOf(1)),
			batcher.load("roadmap", idOf(2)),
		];
		await vi.advanceTimersByTimeAsync(30);
		expect(await Promise.all(pending)).toEqual([
			failed({ kind: "task", id: idOf(1) }),
			failed({ kind: "task", id: idOf(1) }),
			failed({ kind: "roadmap", id: idOf(2) }),
		]);
	});

	it("matches out-of-order results by kind and id", async () => {
		const resolve = vi.fn(async (refs: Ref[]) => refs.map(resolved).reverse());
		const batcher = createEntityBatcher(resolve);
		const pending = [
			batcher.load("task", idOf(1)),
			batcher.load("epic", idOf(2)),
		];
		await vi.advanceTimersByTimeAsync(30);
		expect(await Promise.all(pending)).toEqual([
			resolved({ kind: "task", id: idOf(1) }),
			resolved({ kind: "epic", id: idOf(2) }),
		]);
	});

	it("settles all waiters when a successful response has a malformed body", async () => {
		const resolve = vi.fn(async () => null as unknown as AiResolvedEntity[]);
		const batcher = createEntityBatcher(resolve);
		const pending = [
			batcher.load("task", idOf(1)),
			batcher.load("epic", idOf(2)),
		];
		await vi.advanceTimersByTimeAsync(30);
		expect(await Promise.all(pending)).toEqual([
			failed({ kind: "task", id: idOf(1) }),
			failed({ kind: "epic", id: idOf(2) }),
		]);
	});

	it("fails closed for a missing entry without discarding returned entries", async () => {
		const resolve = vi.fn(async (refs: Ref[]) => [resolved(refs[1])]);
		const batcher = createEntityBatcher(resolve);
		const pending = [
			batcher.load("task", idOf(1)),
			batcher.load("epic", idOf(2)),
		];
		await vi.advanceTimersByTimeAsync(30);
		expect(await Promise.all(pending)).toEqual([
			failed({ kind: "task", id: idOf(1) }),
			resolved({ kind: "epic", id: idOf(2) }),
		]);
	});
});

describe("entity query invalidation", () => {
	it("invalidates every entity while preserving unrelated query data", async () => {
		const client = new QueryClient();
		const taskKey = aiEntityKeys.one("task", idOf(1));
		const epicKey = aiEntityKeys.one("epic", idOf(2));
		client.setQueryData(taskKey, resolved({ kind: "task", id: idOf(1) }));
		client.setQueryData(epicKey, resolved({ kind: "epic", id: idOf(2) }));
		client.setQueryData(["other"], "unchanged");
		expect(aiEntityKeys.all).toEqual(["ai", "entity"]);
		expect(taskKey).toEqual(["ai", "entity", "task", idOf(1)]);
		await invalidateAiEntities(client);
		expect(client.getQueryState(taskKey)?.isInvalidated).toBe(true);
		expect(client.getQueryState(epicKey)?.isInvalidated).toBe(true);
		expect(client.getQueryState(["other"])?.isInvalidated).toBe(false);
		client.clear();
	});
});

describe("traceEventsTouchEntities", () => {
	const event = (name: string, status = "success") => ({
		event: "tool_call_result",
		status,
		details: { tool_name: name },
	});

	it("is true only for a successful admin write", () => {
		expect(traceEventsTouchEntities([event("update_project")])).toBe(true);
		expect(traceEventsTouchEntities([event("create_roadmap")])).toBe(true);
		expect(traceEventsTouchEntities([event("update_project", "error")])).toBe(
			false,
		);
		expect(traceEventsTouchEntities([event("get_workspace_overview")])).toBe(
			false,
		);
		expect(
			traceEventsTouchEntities([
				{
					event: "tool_call_requested",
					status: "running",
					details: { tool_name: "update_project" },
				},
			]),
		).toBe(false);
	});
});
