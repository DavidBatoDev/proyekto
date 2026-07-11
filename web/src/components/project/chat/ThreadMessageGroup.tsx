import EmojiPicker, { type EmojiClickData, Theme } from "emoji-picker-react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useThemeMode } from "@/theme/useThemeMode";
import { ChatAvatar } from "./Avatar";
import { type BubblePosition, ThreadMessageLine } from "./ThreadMessageLine";
import type { ThreadMessageGroup as Group, ThreadUiMessage } from "./thread";

const QUICK_REACTIONS = ["👍", "❤️", "😄", "😢", "🙏", "👎", "😡"];

function positionOf(index: number, total: number): BubblePosition {
	if (total === 1) return "solo";
	if (index === 0) return "first";
	if (index === total - 1) return "last";
	return "middle";
}

export function ThreadMessageGroup({
	group,
	isSelected = false,
	currentUserId,
	highlightedMessageId,
	editingMessageId,
	getSenderName,
	onSelectSender,
	onToggleReaction,
	onRequestUnsend,
	onStartEdit,
	onSubmitEdit,
	onCancelEdit,
	onCopy,
	onReply,
	onJumpToMessage,
}: {
	group: Group;
	isSelected?: boolean;
	currentUserId?: string;
	highlightedMessageId?: string | null;
	editingMessageId?: string | null;
	getSenderName?: (userId: string) => string | undefined;
	onSelectSender?: (userId: string) => void;
	onToggleReaction?: (messageId: string, roomId: string, emoji: string) => void;
	onRequestUnsend?: (message: ThreadUiMessage, bypassConfirm: boolean) => void;
	onStartEdit?: (message: ThreadUiMessage) => void;
	onSubmitEdit?: (message: ThreadUiMessage, content: string) => void;
	onCancelEdit?: () => void;
	onCopy?: (message: ThreadUiMessage) => void;
	onReply?: (message: ThreadUiMessage) => void;
	onJumpToMessage?: (messageId: string) => void;
}) {
	const themeMode = useThemeMode();
	const isMine = !!currentUserId && group.senderId === currentUserId;
	const canSelect = typeof onSelectSender === "function" && !isMine;
	const targetMessage = group.messages[group.messages.length - 1] ?? null;
	const [showPicker, setShowPicker] = useState(false);
	const [burstEmoji, setBurstEmoji] = useState<string | null>(null);
	const pickerRef = useRef<HTMLDivElement | null>(null);
	const total = group.messages.length;

	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (!showPicker) return;
			const target = event.target as Node | null;
			if (!target) return;
			if (pickerRef.current?.contains(target)) return;
			setShowPicker(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setShowPicker(false);
		};

		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [showPicker]);

	const reactWith = (emoji: string) => {
		if (!targetMessage || !onToggleReaction) return;
		onToggleReaction(targetMessage.id, targetMessage.room_id, emoji);
		setBurstEmoji(emoji);
		window.setTimeout(() => setBurstEmoji(null), 420);
	};

	return (
		<div
			className={`group relative mb-1 min-w-0 rounded-md px-2 py-1 transition-colors ${
				isSelected ? "bg-slate-200/70" : ""
			}`}
		>
			{/* Reaction action bar — left for mine, right for theirs */}
			{targetMessage && !targetMessage.deleted_at && onToggleReaction && (
				<div
					ref={pickerRef}
					className={`absolute z-10 transition-all duration-150 ${
						isMine ? "left-2 -top-4" : "right-2 -top-4"
					} ${
						showPicker
							? "pointer-events-auto translate-y-0 opacity-100"
							: "pointer-events-none translate-y-1 opacity-0 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100"
					}`}
				>
					<div className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 py-1 shadow-sm">
						{QUICK_REACTIONS.map((emoji) => (
							<button
								key={`${targetMessage.id}-${emoji}`}
								type="button"
								onClick={() => reactWith(emoji)}
								className="inline-flex h-7 w-7 items-center justify-center rounded-full text-base hover:bg-slate-100"
								aria-label={`React with ${emoji}`}
							>
								{emoji}
							</button>
						))}
						<button
							type="button"
							onClick={() => setShowPicker((current) => !current)}
							className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
							aria-label="Open emoji picker"
						>
							<Plus className="h-4 w-4" />
						</button>
					</div>

					{showPicker && (
						<div
							className={`absolute top-10 z-20 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ${
								isMine ? "left-0" : "right-0"
							}`}
						>
							<EmojiPicker
								width={300}
								height={340}
								skinTonesDisabled
								theme={themeMode === "dark" ? Theme.DARK : Theme.LIGHT}
								onEmojiClick={(emojiData: EmojiClickData) => {
									reactWith(emojiData.emoji);
									setShowPicker(false);
								}}
							/>
						</div>
					)}
				</div>
			)}

			{/* Burst animation */}
			<AnimatePresence>
				{burstEmoji && (
					<motion.div
						key={`burst-${burstEmoji}`}
						initial={{ opacity: 0, y: 6, scale: 0.8 }}
						animate={{ opacity: 1, y: -8, scale: 1.2 }}
						exit={{ opacity: 0, y: -18, scale: 1.35 }}
						transition={{ duration: 0.35, ease: "easeOut" }}
						className={`pointer-events-none absolute -top-2 text-xl ${isMine ? "left-14" : "right-14"}`}
					>
						{burstEmoji}
					</motion.div>
				)}
			</AnimatePresence>

			{/* ── MINE (right-aligned) ─────────────────────────────────────────── */}
			{isMine ? (
				<div className="flex flex-col items-end gap-0.5">
					{group.messages.map((message, index) => (
						<ThreadMessageLine
							key={message.render_key ?? message.id}
							message={message}
							isMine
							position={positionOf(index, total)}
							canModify
							isEditing={!!editingMessageId && message.id === editingMessageId}
							currentUserId={currentUserId}
							getSenderName={getSenderName}
							isHighlighted={
								!!highlightedMessageId && message.id === highlightedMessageId
							}
							onToggleReaction={onToggleReaction}
							onRequestUnsend={onRequestUnsend}
							onStartEdit={onStartEdit}
							onSubmitEdit={onSubmitEdit}
							onCancelEdit={onCancelEdit}
							onCopy={onCopy}
							onReply={onReply}
							onJumpToMessage={onJumpToMessage}
						/>
					))}
				</div>
			) : (
				/* ── THEIRS (left-aligned) ────────────────────────────────────────── */
				<div className="flex items-end gap-2 min-w-0">
					{/* Avatar column — shows avatar only beside the last message */}
					<div className="w-7 shrink-0 self-end">
						{/* Always reserve the space; only render avatar on last message */}
						<div
							className={canSelect ? "cursor-pointer" : ""}
							onClick={
								canSelect ? () => onSelectSender?.(group.senderId) : undefined
							}
							role={canSelect ? "button" : undefined}
							tabIndex={canSelect ? 0 : undefined}
							onKeyDown={
								canSelect
									? (event) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												onSelectSender?.(group.senderId);
											}
										}
									: undefined
							}
							aria-label={
								canSelect ? `View ${group.sender.name} profile` : undefined
							}
						>
							<ChatAvatar
								name={group.sender.name}
								avatarUrl={group.sender.avatarUrl}
								size="sm"
							/>
						</div>
					</div>

					{/* Bubbles column */}
					<div className="flex min-w-0 max-w-[75%] flex-col gap-0.5">
						{/* Sender name above first bubble */}
						<button
							type="button"
							onClick={
								canSelect ? () => onSelectSender?.(group.senderId) : undefined
							}
							disabled={!canSelect}
							className={`mb-0.5 self-start text-[12px] font-semibold text-slate-500 ${
								canSelect
									? "cursor-pointer hover:text-slate-800"
									: "cursor-default"
							}`}
						>
							{group.sender.name}
						</button>

						{group.messages.map((message, index) => (
							<ThreadMessageLine
								key={message.render_key ?? message.id}
								message={message}
								isMine={false}
								position={positionOf(index, total)}
								canModify={false}
								isEditing={
									!!editingMessageId && message.id === editingMessageId
								}
								currentUserId={currentUserId}
								getSenderName={getSenderName}
								isHighlighted={
									!!highlightedMessageId && message.id === highlightedMessageId
								}
								onToggleReaction={onToggleReaction}
								onRequestUnsend={onRequestUnsend}
								onStartEdit={onStartEdit}
								onSubmitEdit={onSubmitEdit}
								onCancelEdit={onCancelEdit}
								onCopy={onCopy}
								onReply={onReply}
								onJumpToMessage={onJumpToMessage}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
