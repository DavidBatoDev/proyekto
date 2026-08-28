import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { useToast } from "@/hooks/useToast";
import {
	type PostingAttachment,
	postingsService,
} from "@/services/postings.service";
import { uploadService } from "@/services/upload.service";

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
 */
export function BriefAttachments({
	postingId,
	attachments,
	canEdit,
	onChange,
}: {
	postingId: string;
	attachments: PostingAttachment[];
	canEdit: boolean;
	onChange: (next: PostingAttachment[]) => void;
}) {
	const toast = useToast();
	const inputRef = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);

	const handleFiles = async (files: FileList | null) => {
		if (!files || files.length === 0) return;
		const picked = [...files];

		if (attachments.length + picked.length > MAX_FILES) {
			toast.error(`A brief can carry up to ${MAX_FILES} files.`);
			return;
		}
		const tooBig = picked.find((file) => file.size > MAX_SIZE_MB * 1024 * 1024);
		if (tooBig) {
			toast.error(`${tooBig.name} is over ${MAX_SIZE_MB}MB.`);
			return;
		}

		setUploading(true);
		const added: PostingAttachment[] = [];
		try {
			for (const file of picked) {
				const meta = await uploadService.uploadBriefAttachment(file);
				added.push(
					await postingsService.addAttachment(postingId, {
						url: meta.url,
						name: meta.name,
						content_type: meta.content_type,
						size: meta.size,
					}),
				);
			}
			onChange([...attachments, ...added]);
		} catch (error) {
			// Whatever landed before the failure is already persisted, so it is
			// shown rather than silently dropped from the list.
			if (added.length > 0) onChange([...attachments, ...added]);
			toast.error(
				error instanceof Error ? error.message : "Failed to attach the file.",
			);
		} finally {
			setUploading(false);
			if (inputRef.current) inputRef.current.value = "";
		}
	};

	const handleRemove = async (attachment: PostingAttachment) => {
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
			{attachments.length > 0 && (
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
				</ul>
			)}

			{canEdit && (
				<>
					<input
						ref={inputRef}
						type="file"
						multiple
						className="hidden"
						onChange={(event) => void handleFiles(event.target.files)}
					/>
					<button
						type="button"
						disabled={uploading}
						onClick={() => inputRef.current?.click()}
						className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
					>
						{uploading ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Paperclip className="h-3.5 w-3.5" />
						)}
						{uploading ? "Uploading…" : "Upload files"}
					</button>
				</>
			)}
		</div>
	);
}
