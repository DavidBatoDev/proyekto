import { useCallback, useEffect, useRef, useState } from "react";
import { type BriefDraft, isBriefDraftEmpty } from "@/lib/briefDraft";
import { clearBriefDraft, writeBriefDraft } from "@/lib/briefDraftStorage";
import {
	deletePendingFile,
	listPendingFiles,
	type PendingFile,
	putPendingFile,
} from "@/lib/pendingFileStore";
import type { PostingAttachment } from "@/services/postings.service";

/** Long enough that a rich-text editor's per-keystroke changes coalesce. */
const WRITE_DEBOUNCE_MS = 400;

export interface ComposerFile extends PendingFile {
	/** `blob:` URL backing the chip's link; revoked when the file leaves. */
	previewUrl: string;
}

/**
 * All the state of a brief being written, plus the browser-side persistence
 * that lets it survive a refresh.
 *
 * `persist` is what separates the two authoring routes: `/brief/new` has no row
 * behind it and mirrors everything into storage, while `/brief/:id/edit` has a
 * server row and only needs the local half for files not yet uploaded.
 *
 * Object-URL hygiene follows `usePendingImages`: every `blob:` minted here is
 * tracked and revoked on removal, after a successful upload, and on unmount.
 */
export function useBriefComposer({
	persist,
	briefId,
	initialDraft,
	initialAttachments = [],
	initialPendingIds = [],
}: {
	persist: boolean;
	briefId: string | null;
	initialDraft: BriefDraft;
	initialAttachments?: PostingAttachment[];
	initialPendingIds?: string[];
}) {
	const [draft, setDraft] = useState<BriefDraft>(initialDraft);
	const [attachments, setAttachments] =
		useState<PostingAttachment[]>(initialAttachments);
	const [pending, setPending] = useState<ComposerFile[]>([]);
	const blobUrls = useRef<string[]>([]);

	// Save handlers run async and read these after an await, where the render
	// closure may already be stale.
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const pendingRef = useRef(pending);
	pendingRef.current = pending;

	const track = useCallback((file: PendingFile): ComposerFile => {
		const previewUrl = URL.createObjectURL(file.file);
		blobUrls.current.push(previewUrl);
		return { ...file, previewUrl };
	}, []);

	const release = useCallback((url: string) => {
		URL.revokeObjectURL(url);
		blobUrls.current = blobUrls.current.filter((tracked) => tracked !== url);
	}, []);

	useEffect(
		() => () => {
			for (const url of blobUrls.current) URL.revokeObjectURL(url);
			blobUrls.current = [];
		},
		[],
	);

	// Read the blobs a stored draft still claims. Ids whose record is gone are
	// dropped silently — the next write rewrites the list from what came back.
	const idsKey = initialPendingIds.join(",");
	useEffect(() => {
		if (idsKey === "") return;
		let cancelled = false;
		void listPendingFiles(idsKey.split(",")).then((files) => {
			if (cancelled) return;
			setPending(files.map(track));
		});
		return () => {
			cancelled = true;
		};
	}, [idsKey, track]);

	const persistNow = useCallback(
		(id: string | null) => {
			if (!persist) return;
			// Nothing typed, nothing attached, no row: leave no record at all, so an
			// editor that was opened and closed does not resurface as a resume
			// prompt on the next visit.
			if (
				id === null &&
				pendingRef.current.length === 0 &&
				isBriefDraftEmpty(draftRef.current)
			) {
				clearBriefDraft();
				return;
			}
			writeBriefDraft({
				briefId: id,
				draft: draftRef.current,
				pendingFileIds: pendingRef.current.map((file) => file.id),
			});
		},
		[persist],
	);

	// Debounced write-through. A flush on pagehide catches the tab being closed
	// inside the debounce window.
	useEffect(() => {
		if (!persist) return;
		const timer = setTimeout(() => persistNow(briefId), WRITE_DEBOUNCE_MS);
		const flush = () => persistNow(briefId);
		window.addEventListener("pagehide", flush);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("pagehide", flush);
		};
	}, [persist, persistNow, briefId, draft, pending]);

	const patch = useCallback(
		(next: Partial<BriefDraft>) =>
			setDraft((current) => ({ ...current, ...next })),
		[],
	);

	const addFiles = useCallback(
		async (files: File[]) => {
			const stored = await Promise.all(
				files.map((file) => putPendingFile(file)),
			);
			setPending((current) => [...current, ...stored.map(track)]);
		},
		[track],
	);

	const removePending = useCallback(
		(id: string) => {
			setPending((current) => {
				const target = current.find((file) => file.id === id);
				if (target) release(target.previewUrl);
				return current.filter((file) => file.id !== id);
			});
			void deletePendingFile(id);
		},
		[release],
	);

	/** Forget everything held locally — after a clean save, or on discard. */
	const clearLocal = useCallback(async () => {
		for (const file of pendingRef.current) release(file.previewUrl);
		await Promise.all(
			pendingRef.current.map((file) => deletePendingFile(file.id)),
		);
		setPending([]);
		clearBriefDraft();
	}, [release]);

	/** Keep only the files that failed to upload; the rest are on the server. */
	const keepPending = useCallback(
		(ids: string[]) => {
			setPending((current) => {
				for (const file of current) {
					if (!ids.includes(file.id)) release(file.previewUrl);
				}
				return current.filter((file) => ids.includes(file.id));
			});
		},
		[release],
	);

	return {
		draft,
		draftRef,
		setDraft,
		patch,
		attachments,
		setAttachments,
		pending,
		pendingRef,
		addFiles,
		removePending,
		keepPending,
		clearLocal,
		persistNow,
	};
}
