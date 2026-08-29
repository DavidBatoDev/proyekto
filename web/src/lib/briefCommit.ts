import { type BriefDraft, toPayload } from "@/lib/briefDraft";
import { deletePendingFile, type PendingFile } from "@/lib/pendingFileStore";
import {
	type PostingAttachment,
	postingsService,
} from "@/services/postings.service";
import { uploadService } from "@/services/upload.service";

/**
 * Writing a brief to the server, in the one order that is safe.
 *
 * Everything before this point is local: the text is in sessionStorage, the
 * files are Blobs in IndexedDB, and nothing has reached the database or R2.
 * This is the moment all of it lands, which makes the ordering load-bearing.
 */

export interface CommitResult {
	briefId: string;
	/** Everything now persisted, in display order. */
	attachments: PostingAttachment[];
	/** Files that still failed to upload and are still held locally. */
	remaining: PendingFile[];
	error: Error | null;
}

export async function commitBrief({
	briefId,
	draft,
	pending,
	existing,
	onRowCreated,
}: {
	briefId: string | null;
	draft: BriefDraft;
	pending: PendingFile[];
	existing: PostingAttachment[];
	/** Awaited BEFORE any upload runs — see below. */
	onRowCreated?: (id: string) => Promise<void> | void;
}): Promise<CommitResult> {
	let id = briefId;
	if (id === null) {
		const created = await postingsService.create(toPayload(draft));
		id = created.id;
		// The id is recorded before a single byte goes to R2, and that is what
		// makes a retry safe: every path from here on sees a non-null briefId and
		// takes the update branch instead of creating a second brief.
		await onRowCreated?.(id);
	} else {
		await postingsService.update(id, toPayload(draft));
	}

	const attachments = [...existing];
	const remaining: PendingFile[] = [];
	let error: Error | null = null;

	// Sequential rather than parallel: each file is an R2 POST plus a database
	// insert, and twenty of those at once is worse for everyone than a visible
	// order. A failure does not abort the loop — file four failing must not
	// strand files five through eight.
	for (const entry of pending) {
		try {
			const meta = await uploadService.uploadBriefAttachment(entry.file);
			attachments.push(await postingsService.addAttachment(id, meta));
			await deletePendingFile(entry.id);
		} catch (cause) {
			remaining.push(entry);
			if (error === null) {
				error =
					cause instanceof Error
						? cause
						: new Error("Failed to attach a file.");
			}
		}
	}

	return { briefId: id, attachments, remaining, error };
}
