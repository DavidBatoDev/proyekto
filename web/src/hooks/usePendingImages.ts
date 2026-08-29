import { useCallback, useEffect, useRef, useState } from "react";
import {
	type PendingImage,
	pendingCount,
	pendingFromFile,
	pendingFromUrls,
	uploadPending,
} from "@/lib/pendingImages";

/**
 * Holds picked images locally and uploads them only when the caller flushes —
 * at save, publish or send. See `@/lib/pendingImages` for why.
 *
 * Object-URL hygiene is the whole reason this is a hook: every `blob:` minted
 * here is tracked and revoked on removal, after a successful upload, and on
 * unmount. The chat composer is the only place in this codebase that already
 * got that right; everywhere else leaks on unmount.
 */
export function usePendingImages(
	initialUrls: Array<string | null | undefined> = [],
) {
	const [items, setItems] = useState<PendingImage[]>(() =>
		pendingFromUrls(initialUrls),
	);
	const blobUrls = useRef<string[]>([]);
	// flush() runs inside an async save handler, where `items` from the render
	// closure may already be stale; the ref is what it reads.
	const itemsRef = useRef(items);
	itemsRef.current = items;

	const track = useCallback((url: string | undefined) => {
		if (url) blobUrls.current.push(url);
	}, []);

	const release = useCallback((url: string | undefined) => {
		if (!url) return;
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

	/** Replace the whole list from persisted URLs (initial load, or a reset). */
	const hydrate = useCallback((urls: Array<string | null | undefined>) => {
		for (const url of blobUrls.current) URL.revokeObjectURL(url);
		blobUrls.current = [];
		setItems(pendingFromUrls(urls));
	}, []);

	const add = useCallback(
		(files: File[]) => {
			const picked = files.map((file) => {
				const item = pendingFromFile(file);
				track(item.previewUrl);
				return item;
			});
			setItems((current) => [...current, ...picked]);
		},
		[track],
	);

	const remove = useCallback(
		(key: string) => {
			setItems((current) => {
				release(current.find((item) => item.key === key)?.previewUrl);
				return current.filter((item) => item.key !== key);
			});
		},
		[release],
	);

	/** Move an image to the front — the cover slot, wherever order matters. */
	const promote = useCallback((key: string) => {
		setItems((current) => {
			const target = current.find((item) => item.key === key);
			if (!target) return current;
			return [target, ...current.filter((item) => item.key !== key)];
		});
	}, []);

	const reorder = useCallback((next: PendingImage[]) => setItems(next), []);

	/**
	 * Upload what is still local and return every URL in display order.
	 * Throws if any upload failed — the caller must not persist a partial set.
	 */
	const flush = useCallback(
		async (upload: (file: File) => Promise<string>): Promise<string[]> => {
			const current = itemsRef.current;
			if (current.every((item) => !item.file)) {
				return current
					.map((item) => item.url)
					.filter((url): url is string => !!url);
			}

			const result = await uploadPending(current, upload);

			// Write successes back before throwing, so a retry re-uploads only
			// what actually failed.
			for (const item of current) {
				const stillPending = result.items.find(
					(next) => next.key === item.key,
				)?.file;
				if (item.previewUrl && !stillPending) release(item.previewUrl);
			}
			setItems(result.items);
			itemsRef.current = result.items;

			if (result.error) throw result.error;
			return result.uploaded;
		},
		[release],
	);

	return {
		items,
		add,
		remove,
		promote,
		reorder,
		hydrate,
		flush,
		pendingCount: pendingCount(items),
	};
}
