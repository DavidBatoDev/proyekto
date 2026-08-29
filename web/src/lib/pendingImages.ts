/**
 * Images a user has picked but not yet committed.
 *
 * The rule this exists to enforce: nothing reaches R2 until the user saves.
 * A picked file lives in browser memory behind a `blob:` preview; the upload
 * happens at the commit, so abandoning an edit leaves no orphaned object in
 * the bucket (nothing in this codebase ever deletes one).
 *
 * Pure helpers only — the React lifecycle, including object-URL revocation,
 * lives in `@/hooks/usePendingImages`.
 */

export interface PendingImage {
	/** Stable local key: URLs change on upload, so they cannot be React keys. */
	key: string;
	/** The persisted URL, or null while the file is still local. */
	url: string | null;
	/** Set while the image is waiting to be uploaded. */
	file?: File;
	/** `blob:` URL backing the preview; revoked once uploaded or removed. */
	previewUrl?: string;
}

let keyCounter = 0;
function nextKey(): string {
	keyCounter += 1;
	return `img-${keyCounter}`;
}

export function pendingFromUrls(
	urls: Array<string | null | undefined>,
): PendingImage[] {
	return urls
		.filter((url): url is string => !!url)
		.map((url) => ({ key: nextKey(), url }));
}

/** A picked file, previewed locally until the next save uploads it. */
export function pendingFromFile(file: File): PendingImage {
	return {
		key: nextKey(),
		url: null,
		file,
		previewUrl: URL.createObjectURL(file),
	};
}

/** What an `<img src>` should point at right now. */
export function srcOf(item: PendingImage): string {
	return item.url ?? item.previewUrl ?? "";
}

export function isPending(item: PendingImage): boolean {
	return !!item.file;
}

export function pendingCount(items: PendingImage[]): number {
	return items.filter(isPending).length;
}

/**
 * Upload everything still local, in parallel, preserving display order.
 *
 * Successes are written back into the returned list even when a sibling
 * fails, so a retry after a partial failure never re-uploads what already
 * landed — the guard `PortfolioModal` gets right by checking `!form.image_url`
 * before uploading again. The caller is handed both halves: the new list to
 * store, and the failure to surface.
 */
export async function uploadPending(
	items: PendingImage[],
	upload: (file: File) => Promise<string>,
): Promise<{ items: PendingImage[]; uploaded: string[]; error: unknown }> {
	const settled = await Promise.allSettled(
		items.map((item) =>
			item.file ? upload(item.file) : Promise.resolve(item.url),
		),
	);

	let error: unknown = null;
	const next = items.map((item, index) => {
		const result = settled[index];
		if (result.status === "rejected") {
			if (error === null) error = result.reason;
			return item;
		}
		if (!item.file) return item;
		// Drop the file and preview: this image is persisted now.
		return { key: item.key, url: result.value };
	});

	return {
		items: next,
		uploaded: next
			.map((item) => item.url)
			.filter((url): url is string => !!url),
		error,
	};
}
