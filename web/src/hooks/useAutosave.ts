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
		onError?: (err: Error) => void;
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
