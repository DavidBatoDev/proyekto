import { FileText, Paperclip, X } from "lucide-react";
import { useRef } from "react";
import type { ComposerFile } from "@/hooks/useBriefComposer";
import { useToast } from "@/hooks/useToast";
import {
	type PostingAttachment,
	postingsService,
} from "@/services/postings.service";

/** Mirrors the `brief_attachments` bucket cap in the backend and the Worker. */
const MAX_SIZE_MB = 25;
const MAX_FILES = 20;

function formatSize(bytes: number | null): string {
	if (bytes === null) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Files that come with a brief: a spec, wireframes, an existing RFP.
 *
 * A chip strip rather than a modal picker — the same shape the chat composer
 * uses. `UploadModal` is the other candidate and the wrong one here: its
 * validation only really understands `image/*`, and half of what lands on a
 * brief is a PDF or a spreadsheet.
 *
 * Nothing here uploads. A picked file is held locally until the brief is saved,
 * because the brief may not exist yet — the same rule `pendingImages` states for
 * every other picker in this codebase: nothing reaches R2 until the user saves.
 * So the strip shows two kinds of row, persisted and pending, and only the
 * persisted ones have a server round-trip behind their delete.
 */
export function BriefAttachments({
	postingId,
	attachments,
	pending,
	canEdit,
	onChange,
	onPickFiles,
	onRemovePending,
}: {
	postingId: string | null;
	attachments: PostingAttachment[];
	pending: ComposerFile[];
	canEdit: boolean;
	onChange: (next: PostingAttachment[]) => void;
	onPickFiles: (files: File[]) => void;
	onRemovePending: (id: string) => void;
}) {
	const toast = useToast();
	const inputRef = useRef<HTMLInputElement>(null);
	const total = attachments.length + pending.length;

	const handleFiles = (files: FileList | null) => {
		if (!files || files.length === 0) return;
		const picked = [...files];

		if (total + picked.length > MAX_FILES) {
			toast.error(`A brief can carry up to ${MAX_FILES} files.`);
			return;
		}
		const tooBig = picked.find((file) => file.size > MAX_SIZE_MB * 1024 * 1024);
		if (tooBig) {
			toast.error(`${tooBig.name} is over ${MAX_SIZE_MB}MB.`);
			return;
		}

		onPickFiles(picked);
		if (inputRef.current) inputRef.current.value = "";
	};

	const handleRemove = async (attachment: PostingAttachment) => {
		// A persisted attachment cannot exist without a row, so `postingId` is
		// non-null on this path by construction.
		if (!postingId) return;
		const previous = attachments;
		onChange(attachments.filter((entry) => entry.id !== attachment.id));
		try {
			await postingsService.removeAttachment(postingId, attachment.id);
		} catch (error) {
			onChange(previous);
			toast.error(
				error instanceof Error ? error.message : "Failed to remove the file.",
			);
		}
	};

	return (
		<div className="space-y-2">
			{total > 0 && (
				<ul className="space-y-1.5">
					{attachments.map((attachment) => (
						<li
							key={attachment.id}
							className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2"
						>
							<FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
							<a
								href={attachment.url}
								target="_blank"
								rel="noreferrer"
								className="min-w-0 flex-1 truncate text-[13px] text-foreground hover:underline"
							>
								{attachment.name}
							</a>
							<span className="shrink-0 text-[11.5px] text-muted-foreground">
								{formatSize(attachment.size)}
							</span>
							{canEdit && (
								<button
									type="button"
									onClick={() => void handleRemove(attachment)}
									aria-label={`Remove ${attachment.name}`}
									className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							)}
						</li>
					))}

					{pending.map((file) => (
						<li
							key={file.id}
							className="flex items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-2"
						>
							<FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
							<a
								href={file.previewUrl}
								target="_blank"
								rel="noreferrer"
								className="min-w-0 flex-1 truncate text-[13px] text-foreground hover:underline"
							>
								{file.name}
							</a>
							<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
								Not saved
							</span>
							<span className="shrink-0 text-[11.5px] text-muted-foreground">
								{formatSize(file.size)}
							</span>
							{canEdit && (
								<button
									type="button"
									onClick={() => onRemovePending(file.id)}
									aria-label={`Remove ${file.name}`}
									className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							)}
						</li>
					))}
				</ul>
			)}

			{canEdit && (
				<>
					<input
						ref={inputRef}
						type="file"
						multiple
						className="hidden"
						onChange={(event) => handleFiles(event.target.files)}
					/>
					<button
						type="button"
						onClick={() => inputRef.current?.click()}
						disabled={total >= MAX_FILES}
						className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
					>
						<Paperclip className="h-3.5 w-3.5" />
						Add files
					</button>
					<p className="text-[11.5px] text-muted-foreground">
						Up to {MAX_FILES} files, {MAX_SIZE_MB}MB each. They upload when you
						save the brief.
					</p>
				</>
			)}
		</div>
	);
}
