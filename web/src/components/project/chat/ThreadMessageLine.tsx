import { motion } from "framer-motion";
import { Download, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChatAttachment } from "@/services/chat.service";
import { resolveAttachmentSrc } from "./attachmentPreviewCache";
import { MessageActionsMenu } from "./MessageActionsMenu";
import { mentionsCurrentUser, renderMentionContent } from "./mentions";
import type { ThreadUiMessage } from "./thread";

export type BubblePosition = "solo" | "first" | "middle" | "last";

/** Grow a textarea to fit its content, capped so long edits scroll. */
function autoSizeTextarea(el: HTMLTextAreaElement): void {
	el.style.height = "auto";
	// box-sizing is border-box but scrollHeight omits the 1px top/bottom border,
	// so the content sits ~2px taller than the box and the textarea sprouts its
	// own scrollbar. Add the border back, and keep overflow hidden until we
	// actually exceed the max height.
	const max = 200;
	const needed = el.scrollHeight + 2;
	el.style.height = `${Math.min(needed, max)}px`;
	el.style.overflowY = needed > max ? "auto" : "hidden";
}

function formatBytes(bytes: number): string {
	if (!bytes || bytes < 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		units.length - 1,
	);
	const value = bytes / 1024 ** i;
	return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function bubbleRadius(isMine: boolean, position: BubblePosition): string {
	if (isMine) {
		switch (position) {
			case "solo":
				return "rounded-2xl";
			case "first":
				return "rounded-2xl rounded-br-md";
			case "middle":
				return "rounded-l-2xl rounded-r-md";
			case "last":
				return "rounded-2xl rounded-tr-md";
		}
	} else {
		switch (position) {
			case "solo":
				return "rounded-2xl";
			case "first":
				return "rounded-2xl rounded-bl-md";
			case "middle":
				return "rounded-r-2xl rounded-l-md";
			case "last":
				return "rounded-2xl rounded-tl-md";
		}
	}
}

function AttachmentBlock({
	attachment,
	isMine,
}: {
	attachment: ChatAttachment;
	isMine: boolean;
}) {
	const isImage = attachment.content_type.startsWith("image/");

	if (isImage) {
		const displaySrc = resolveAttachmentSrc(attachment.url);
		return (
			<a
				href={attachment.url}
				target="_blank"
				rel="noopener noreferrer"
				className="block w-fit"
			>
				<img
					src={displaySrc}
					alt={attachment.name}
					loading="lazy"
					className="max-h-72 w-full max-w-60 rounded-2xl object-cover transition-opacity hover:opacity-95 sm:max-w-xs"
				/>
			</a>
		);
	}

	return (
		<a
			href={attachment.url}
			target="_blank"
			rel="noopener noreferrer"
			download={attachment.name}
			className={`flex w-fit max-w-[220px] items-center gap-3 rounded-lg border px-3 py-2 transition-colors sm:max-w-xs ${
				isMine
					? "border-white/20 bg-white/10 hover:bg-white/20"
					: "border-slate-200 bg-white hover:bg-slate-50"
			}`}
		>
			<FileText
				className={`h-8 w-8 shrink-0 ${isMine ? "text-white/70" : "text-slate-500"}`}
			/>
			<div className="min-w-0">
				<p
					className={`truncate text-sm font-medium ${isMine ? "text-white" : "text-slate-800"}`}
				>
					{attachment.name}
				</p>
				<p className={`text-xs ${isMine ? "text-white/60" : "text-slate-500"}`}>
					{formatBytes(attachment.size)}
				</p>
			</div>
			<Download
				className={`h-4 w-4 shrink-0 ${isMine ? "text-white/60" : "text-slate-400"}`}
			/>
		</a>
	);
}

export function ThreadMessageLine({
	message,
	isMine = false,
	position = "solo",
	canModify,
	isEditing,
	isHighlighted,
	currentUserId,
	getSenderName,
	onToggleReaction,
	onRequestUnsend,
	onStartEdit,
	onSubmitEdit,
	onCancelEdit,
	onCopy,
	onReply,
	onJumpToMessage,
}: {
	message: ThreadUiMessage;
	isMine?: boolean;
	position?: BubblePosition;
	/** Viewer owns this message → Edit/Delete are offered. */
	canModify?: boolean;
	/** This message is currently being edited inline. */
	isEditing?: boolean;
	isHighlighted?: boolean;
	currentUserId?: string;
	getSenderName?: (userId: string) => string | undefined;
	onToggleReaction?: (messageId: string, roomId: string, emoji: string) => void;
	onRequestUnsend?: (message: ThreadUiMessage, bypassConfirm: boolean) => void;
	onStartEdit?: (message: ThreadUiMessage) => void;
	onSubmitEdit?: (message: ThreadUiMessage, content: string) => void;
	onCancelEdit?: () => void;
	onCopy?: (message: ThreadUiMessage) => void;
	onReply?: (message: ThreadUiMessage) => void;
	onJumpToMessage?: (messageId: string) => void;
}) {
	const isSending = message.optimisticStatus === "sending";
	const isDeleted = !!message.deleted_at;
	const isEdited = !!message.edited_at && !isDeleted;
	const hasText = message.content.trim().length > 0;
	const attachments = message.attachments ?? [];
	const pingsViewer =
		!isDeleted &&
		message.sender_id !== currentUserId &&
		mentionsCurrentUser(message.mentions, currentUserId);

	const radius = bubbleRadius(isMine, position);
	const bubbleColor = isMine
		? "bg-primary text-white"
		: pingsViewer
			? "bg-violet-100 text-slate-900"
			: "bg-slate-100 text-slate-900";

	const highlightRing = isHighlighted
		? "ring-2 ring-amber-400 ring-offset-1"
		: "";

	// Split attachments so images in mixed (text+image) messages render outside
	// the colored bubble — otherwise the bubble padding creates a colored frame
	// around the photo. File attachments stay inside the bubble alongside the text.
	const imageAttachments = attachments.filter((a) =>
		a.content_type.startsWith("image/"),
	);
	const fileAttachments = attachments.filter(
		(a) => !a.content_type.startsWith("image/"),
	);

	// Pure media message: no text at all — no colored bubble wrapper needed
	const isMediaOnly = !hasText && attachments.length > 0;
	// Mixed: text (and files) go in the bubble; images rendered as separate items below
	const outlineImages = hasText ? imageAttachments : [];
	// Attachments rendered inside the bubble
	const bubbleAttachments = hasText ? fileAttachments : attachments;

	const align = isMine ? "items-end" : "items-start";

	// ── Tombstone: a soft-deleted message shows only a muted placeholder ──
	if (isDeleted) {
		return (
			<div
				data-message-id={message.id}
				className={`group/line relative min-w-0 flex flex-col gap-1 ${align}`}
			>
				<div
					className={`inline-flex max-w-full items-center ${radius} border border-dashed border-slate-300 px-3.5 py-2`}
				>
					<span className="text-sm italic text-slate-400 md:text-[15px]">
						This message was deleted
					</span>
				</div>
			</div>
		);
	}

	return (
		<div
			data-message-id={message.id}
			className={`group/line relative min-w-0 flex flex-col gap-1 ${align} ${isSending ? "opacity-60" : ""}`}
		>
			{/* ── Reply quote (the message this one replies to) ── */}
			{message.reply_to && (
				<ReplyQuote
					replyTo={message.reply_to}
					isMine={isMine}
					name={getSenderName?.(message.reply_to.sender_id)}
					onClick={() => {
						if (message.reply_to) onJumpToMessage?.(message.reply_to.id);
					}}
				/>
			)}

			{isEditing ? (
				<InlineEditor
					initialValue={message.content}
					isMine={isMine}
					onSubmit={(value) => onSubmitEdit?.(message, value)}
					onCancel={() => onCancelEdit?.()}
				/>
			) : (
				<>
					{/* ── Colored bubble: text + file attachments ── */}
					{(hasText || bubbleAttachments.length > 0) && (
						<div className="relative inline-block max-w-full">
							<div
								className={`inline-block max-w-full ${radius} ${highlightRing} ${
									isMediaOnly ? "overflow-hidden" : `px-3.5 py-2 ${bubbleColor}`
								}`}
							>
								{hasText && (
									<p
										className={`text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere md:text-[15px] ${
											isMine ? "text-white" : "text-slate-900"
										}`}
									>
										{renderMentionContent(message.content, message.mentions, {
											currentUserId,
											isMine,
										})}
										{isEdited && (
											<span
												className={`ml-1.5 align-baseline text-[11px] ${
													isMine ? "text-white/60" : "text-slate-400"
												}`}
											>
												(edited)
											</span>
										)}
									</p>
								)}

								{bubbleAttachments.length > 0 && (
									<div
										className={`flex flex-col gap-2 ${hasText ? "mt-1.5" : ""}`}
									>
										{bubbleAttachments.map((attachment, index) => (
											<AttachmentBlock
												key={`${message.id}-att-${index}`}
												attachment={attachment}
												isMine={isMine}
											/>
										))}
									</div>
								)}
							</div>

							{/* Per-message actions (⋯) — hidden while the send is in flight */}
							{!message.optimisticStatus && (
								<MessageActionsMenu
									isMine={isMine}
									canModify={!!canModify}
									hasText={hasText}
									onReply={onReply ? () => onReply(message) : undefined}
									onCopy={hasText && onCopy ? () => onCopy(message) : undefined}
									onEdit={
										canModify && hasText && onStartEdit
											? () => onStartEdit(message)
											: undefined
									}
									onDelete={
										canModify && onRequestUnsend
											? (bypass) => onRequestUnsend(message, bypass)
											: undefined
									}
								/>
							)}
						</div>
					)}

					{/* ── Images in mixed messages: no bubble background ── */}
					{outlineImages.map((attachment, index) => (
						<a
							key={`${message.id}-img-${index}`}
							href={attachment.url}
							target="_blank"
							rel="noopener noreferrer"
							className="block"
						>
							<img
								src={resolveAttachmentSrc(attachment.url)}
								alt={attachment.name}
								loading="lazy"
								className="max-h-72 w-full max-w-60 rounded-2xl object-cover transition-opacity hover:opacity-95 sm:max-w-xs"
							/>
						</a>
					))}

					{/* ── Reactions ── */}
					{message.reactions && message.reactions.length > 0 && (
						<div
							className={`mt-1 flex flex-wrap gap-1 ${isMine ? "justify-end" : "justify-start"}`}
						>
							{message.reactions.map((reaction, index) => (
								<motion.button
									key={`${message.id}-${reaction.emoji}`}
									type="button"
									initial={{ opacity: 0, y: 4, scale: 0.9 }}
									animate={{ opacity: 1, y: 0, scale: 1 }}
									transition={{
										duration: 0.18,
										ease: "easeOut",
										delay: index * 0.02,
									}}
									onClick={() =>
										onToggleReaction?.(
											message.id,
											message.room_id,
											reaction.emoji,
										)
									}
									className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
										reaction.reacted_by_me
											? "border-slate-400 bg-slate-200 text-slate-800"
											: "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
									}`}
								>
									<span>{reaction.emoji}</span>
									<span>{reaction.count}</span>
								</motion.button>
							))}
						</div>
					)}

					{/* ── Send status ── */}
					{message.optimisticStatus === "failed" && (
						<p
							className={`mt-0.5 text-[11px] text-red-500 ${isMine ? "text-right" : ""}`}
						>
							Failed to send
						</p>
					)}
				</>
			)}
		</div>
	);
}

/** Inline editor that replaces a message bubble while the sender edits it. */
function InlineEditor({
	initialValue,
	isMine,
	onSubmit,
	onCancel,
}: {
	initialValue: string;
	isMine: boolean;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}) {
	const [value, setValue] = useState(initialValue);
	const ref = useRef<HTMLTextAreaElement | null>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.focus();
		const end = el.value.length;
		el.setSelectionRange(end, end);
		autoSizeTextarea(el);
	}, []);

	const submit = () => {
		const trimmed = value.trim();
		if (!trimmed) return;
		onSubmit(trimmed);
	};

	return (
		<div
			className={`flex w-full max-w-full flex-col gap-1 ${isMine ? "items-end" : "items-start"}`}
		>
			<textarea
				ref={ref}
				value={value}
				onChange={(event) => {
					setValue(event.target.value);
					autoSizeTextarea(event.target);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						submit();
					} else if (event.key === "Escape") {
						event.preventDefault();
						onCancel();
					}
				}}
				rows={1}
				className="w-72 max-w-full resize-none rounded-2xl border border-slate-300 bg-white px-3.5 py-2 text-sm leading-relaxed text-slate-900 shadow-sm focus:border-violet-400 focus:outline-none md:text-[15px]"
			/>
			<div
				className={`flex items-center gap-2 text-[11px] text-slate-400 ${
					isMine ? "flex-row-reverse" : ""
				}`}
			>
				<button
					type="button"
					onClick={submit}
					className="font-medium text-violet-600 hover:text-violet-700"
				>
					Save
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="hover:text-slate-600"
				>
					Cancel
				</button>
				<span className="hidden sm:inline">Esc to cancel · Enter to save</span>
			</div>
		</div>
	);
}

/** Small quoted preview of the message being replied to. */
function ReplyQuote({
	replyTo,
	isMine,
	name,
	onClick,
}: {
	replyTo: NonNullable<ThreadUiMessage["reply_to"]>;
	isMine: boolean;
	name?: string;
	onClick: () => void;
}) {
	const deleted = !!replyTo.deleted_at;
	const preview = deleted
		? "Deleted message"
		: replyTo.content.trim() || "Attachment";
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex max-w-[75%] items-center gap-1.5 rounded-md border-l-2 border-slate-300 bg-slate-50 px-2 py-1 text-left text-xs text-slate-500 transition-colors hover:bg-slate-100 ${
				isMine ? "self-end" : "self-start"
			}`}
		>
			<span className="shrink-0 font-medium text-slate-600">
				{name ?? "Unknown"}
			</span>
			<span className={`truncate ${deleted ? "italic text-slate-400" : ""}`}>
				{preview}
			</span>
		</button>
	);
}
