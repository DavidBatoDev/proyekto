/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftAutosave } from "./useAutosave";

type Props = {
	draft: { title: string };
	baseline: { title: string };
	resetKey: string;
	enabled?: boolean;
};

function setup(save: (v: { title: string }) => Promise<unknown>) {
	return renderHook(
		(props: Props) => useDraftAutosave({ ...props, save, delay: 500 }),
		{
			initialProps: {
				draft: { title: "a" },
				baseline: { title: "a" },
				resetKey: "open:1",
			},
		},
	);
}

describe("useDraftAutosave", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("does not save the unchanged baseline", async () => {
		const save = vi.fn(() => Promise.resolve());
		setup(save);
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});
		expect(save).not.toHaveBeenCalled();
	});

	it("debounces edits and reports saving then saved", async () => {
		let resolve: () => void = () => {};
		const save = vi.fn(
			() =>
				new Promise<void>((r) => {
					resolve = r;
				}),
		);
		const { result, rerender } = setup(save);
		const base = { baseline: { title: "a" }, resetKey: "open:1" };
		rerender({ ...base, draft: { title: "ab" } });
		rerender({ ...base, draft: { title: "abc" } });
		await act(async () => {
			vi.advanceTimersByTime(500);
		});
		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenLastCalledWith({ title: "abc" });
		expect(result.current.status).toBe("saving");
		await act(async () => {
			resolve();
		});
		expect(result.current.status).toBe("saved");
	});

	it("queues an edit made during an in-flight save instead of overlapping", async () => {
		const resolvers: Array<() => void> = [];
		const save = vi.fn(
			() => new Promise<void>((r) => resolvers.push(() => r())),
		);
		const { result, rerender } = setup(save);
		const base = { baseline: { title: "a" }, resetKey: "open:1" };
		rerender({ ...base, draft: { title: "b" } });
		await act(async () => {
			vi.advanceTimersByTime(500);
		});
		rerender({ ...base, draft: { title: "c" } });
		act(() => result.current.flush());
		expect(save).toHaveBeenCalledTimes(1);
		await act(async () => {
			resolvers[0]();
		});
		expect(save).toHaveBeenCalledTimes(2);
		expect(save).toHaveBeenLastCalledWith({ title: "c" });
	});

	it("adopts the new baseline on reset without saving", async () => {
		const save = vi.fn(() => Promise.resolve());
		const { rerender } = setup(save);
		// The render that opens a different entity still carries the old draft…
		rerender({
			draft: { title: "a" },
			baseline: { title: "z" },
			resetKey: "open:2",
		});
		// …and the next one has the seeded draft.
		rerender({
			draft: { title: "z" },
			baseline: { title: "z" },
			resetKey: "open:2",
		});
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});
		expect(save).not.toHaveBeenCalled();
	});

	it("flush() saves a pending edit immediately", async () => {
		const save = vi.fn(() => Promise.resolve());
		const { result, rerender } = setup(save);
		rerender({
			draft: { title: "b" },
			baseline: { title: "a" },
			resetKey: "open:1",
		});
		await act(async () => {
			result.current.flush();
		});
		expect(save).toHaveBeenCalledWith({ title: "b" });
	});
});
