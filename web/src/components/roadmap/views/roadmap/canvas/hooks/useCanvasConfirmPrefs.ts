import { useCallback, useState } from "react";

/**
 * "Don't ask again" preferences for the three canvas drag-confirm modals.
 *
 * Stored in `sessionStorage`, not `localStorage`, on purpose: suppressing the
 * confirmation is a within-session convenience while the user is doing a batch
 * of reordering, and it should lapse when they come back later.
 *
 * Keys are the originals — changing them would silently un-suppress every user's
 * saved preference.
 */
const KEYS = {
	epicReorder: "roadmap.canvas.skipEpicReorderConfirm",
	featureReorder: "roadmap.canvas.skipFeatureReorderConfirm",
	featureMove: "roadmap.canvas.skipFeatureMoveConfirm",
} as const;

export type CanvasConfirmKind = keyof typeof KEYS;

/** Reads defensively: a disabled/absent sessionStorage must not break the canvas. */
function read(kind: CanvasConfirmKind): boolean {
	try {
		return sessionStorage.getItem(KEYS[kind]) === "true";
	} catch {
		return false;
	}
}

function write(kind: CanvasConfirmKind, value: boolean): void {
	try {
		sessionStorage.setItem(KEYS[kind], String(value));
	} catch {
		// Preference is best-effort; the in-memory state still applies this session.
	}
}

export interface CanvasConfirmPrefs {
	skipEpicReorder: boolean;
	skipFeatureReorder: boolean;
	skipFeatureMove: boolean;
	/** Updates state and persists in one call, so the two cannot drift apart. */
	setSkip: (kind: CanvasConfirmKind, value: boolean) => void;
}

export function useCanvasConfirmPrefs(): CanvasConfirmPrefs {
	const [skipEpicReorder, setSkipEpicReorder] = useState(() =>
		read("epicReorder"),
	);
	const [skipFeatureReorder, setSkipFeatureReorder] = useState(() =>
		read("featureReorder"),
	);
	const [skipFeatureMove, setSkipFeatureMove] = useState(() =>
		read("featureMove"),
	);

	const setSkip = useCallback((kind: CanvasConfirmKind, value: boolean) => {
		if (kind === "epicReorder") setSkipEpicReorder(value);
		else if (kind === "featureReorder") setSkipFeatureReorder(value);
		else setSkipFeatureMove(value);
		write(kind, value);
	}, []);

	return { skipEpicReorder, skipFeatureReorder, skipFeatureMove, setSkip };
}
