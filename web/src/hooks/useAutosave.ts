import { useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Debounced auto-save for form drafts. Watches `value`, and whenever it changes
 * from the last-persisted snapshot, waits `delay` ms of quiet and then calls
 * `save`. Any change still pending when the component unmounts (e.g. the user
 * switches contract steps) is flushed immediately, so no edit is lost.
 *
 * Change detection is by JSON identity, so `value` may be a fresh object each
 * render without causing spurious saves. The first render never saves (the
 * initial draft is treated as already-persisted).
 *
 * On failure the snapshot is un-marked so the next edit retries, and the status
 * reports `error`; callers surface it however they like (inline + a toast).
 */
export function useAutosave<T>(
	value: T,
	save: (value: T) => Promise<unknown>,
	opts: {
		delay?: number;
		enabled?: boolean;
		onError?: (err: Error, failedValue: T) => void;
	} = {},
): AutosaveStatus {
	const { delay = 700, enabled = true } = opts;
	const [status, setStatus] = useState<AutosaveStatus>("idle");

	const serialized = JSON.stringify(value);
	const savedRef = useRef<string>(serialized);
	const valueRef = useRef<T>(value);
	const saveRef = useRef(save);
	const onErrorRef = useRef(opts.onError);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mountedRef = useRef(true);

	valueRef.current = value;
	saveRef.current = save;
	onErrorRef.current = opts.onError;

	// Stable flush that always reads the latest value/save via refs, so it can be
	// called from an unmount cleanup without going stale.
	const flushRef = useRef<() => void>(() => {});
	flushRef.current = () => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		const snapshot = valueRef.current;
		const snapSerialized = JSON.stringify(snapshot);
		if (snapSerialized === savedRef.current) return;
		savedRef.current = snapSerialized;
		if (mountedRef.current) setStatus("saving");
		Promise.resolve(saveRef.current(snapshot))
			.then(() => {
				if (mountedRef.current) setStatus("saved");
			})
			.catch((err: unknown) => {
				// Let the next edit retry this change.
				savedRef.current = "";
				if (mountedRef.current) setStatus("error");
				onErrorRef.current?.(
					err instanceof Error ? err : new Error("Auto-save failed"),
					snapshot,
				);
			});
	};

	useEffect(() => {
		if (!enabled) return;
		if (serialized === savedRef.current) return;
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => flushRef.current(), delay);
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [serialized, delay, enabled]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			flushRef.current();
		};
	}, []);

	return status;
}

/**
 * Debounced auto-save for an editor that stays open across saves (the roadmap
 * epic/feature/task editors). Differs from useAutosave in three ways:
 *
 * - `baseline` is what the entity looked like when the editor opened, built
 *   with the same normaliser as `draft`. It is adopted only when `resetKey`
 *   changes (open / switch entity), never from later store updates, so an
 *   optimistic write or a rollback can't make the hook chase its own tail.
 * - Saves are serialised: an edit made while a save is in flight waits for it,
 *   then saves the latest draft. The roadmap store drops an update for a node
 *   that already has one pending, so overlapping saves would lose edits.
 * - `flush()` is exposed so closing the editor can push the last edit out
 *   immediately instead of waiting for the debounce.
 */
export function useDraftAutosave<T>({
	draft,
	baseline,
	resetKey,
	save,
	enabled = true,
	delay = 800,
}: {
	draft: T;
	baseline: T;
	resetKey: string;
	save: (value: T) => Promise<unknown>;
	/** Gates the debounce only; flush() always saves a pending change. */
	enabled?: boolean;
	delay?: number;
}): { status: AutosaveStatus; flush: () => void } {
	const [status, setStatus] = useState<AutosaveStatus>("idle");
	const draftKey = JSON.stringify(draft);
	const baselineKey = JSON.stringify(baseline);

	const savedRef = useRef(baselineKey);
	const draftRef = useRef(draft);
	const saveRef = useRef(save);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inFlightRef = useRef(false);
	const queuedRef = useRef(false);
	const mountedRef = useRef(true);
	const generationRef = useRef(0);
	const enabledRef = useRef(enabled);
	const baselineKeyRef = useRef(baselineKey);

	draftRef.current = draft;
	saveRef.current = save;
	baselineKeyRef.current = baselineKey;
	enabledRef.current = enabled;

	const runRef = useRef<() => void>(() => {});
	runRef.current = () => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		if (inFlightRef.current) {
			queuedRef.current = true;
			return;
		}
		const snapshot = draftRef.current;
		const key = JSON.stringify(snapshot);
		if (key === savedRef.current) return;
		inFlightRef.current = true;
		const generation = generationRef.current;
		const isCurrent = () =>
			mountedRef.current && generation === generationRef.current;
		if (mountedRef.current) setStatus("saving");
		Promise.resolve(saveRef.current(snapshot))
			.then(() => {
				if (generation !== generationRef.current) return;
				savedRef.current = key;
				if (isCurrent()) setStatus("saved");
			})
			.catch(() => {
				// savedRef is left alone, so the next edit (or the close flush)
				// retries this change. The caller already toasts the failure.
				if (isCurrent()) setStatus("error");
			})
			.finally(() => {
				inFlightRef.current = false;
				if (queuedRef.current) {
					queuedRef.current = false;
					runRef.current();
				}
			});
	};

	// Declared before the scheduling effect so a reset lands first when both
	// change in the same commit (the render that opens the editor).
	useEffect(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		// A save still in flight from before the reset finishes on its own;
		// the generation bump keeps its result from touching the new baseline.
		generationRef.current += 1;
		savedRef.current = baselineKeyRef.current;
		setStatus("idle");
	}, [resetKey]);

	useEffect(() => {
		if (!enabled) return;
		if (draftKey === savedRef.current) return;
		timerRef.current = setTimeout(() => runRef.current(), delay);
		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [draftKey, enabled, delay]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			if (enabledRef.current) runRef.current();
		};
	}, []);

	const flushRef = useRef(() => runRef.current());
	return { status, flush: flushRef.current };
}
