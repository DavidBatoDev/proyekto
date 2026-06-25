import { Loader2 } from "lucide-react";
import { ThreadDateSeparator } from "./ThreadDateSeparator";
import { ThreadGapSeparator } from "./ThreadGapSeparator";
import { ThreadMessageGroup } from "./ThreadMessageGroup";
import {
	buildThreadBlocks,
	type ThreadSender,
	type ThreadUiMessage,
} from "./thread";

export function MessageList({
	isLoading,
	hasMessages,
	messages,
	senderMap,
	currentUserId,
	selectedSenderId,
	editingMessageId,
	onSelectSender,
	onToggleReaction,
	onRequestUnsend,
	onStartEdit,
	onSubmitEdit,
	onCancelEdit,
	onCopy,
	onReply,
	onJumpToMessage,
	hasNextPage,
	isFetchingNextPage,
	emptyTitle,
	emptySubtitle,
	highlightedMessageId,
}: {
	isLoading: boolean;
	hasMessages: boolean;
	messages: ThreadUiMessage[];
	senderMap: Record<string, ThreadSender>;
	currentUserId?: string;
	selectedSenderId?: string | null;
	editingMessageId?: string | null;
	onSelectSender?: (userId: string) => void;
	onToggleReaction?: (messageId: string, roomId: string, emoji: string) => void;
	onRequestUnsend?: (message: ThreadUiMessage, bypassConfirm: boolean) => void;
	onStartEdit?: (message: ThreadUiMessage) => void;
	onSubmitEdit?: (message: ThreadUiMessage, content: string) => void;
	onCancelEdit?: () => void;
	onCopy?: (message: ThreadUiMessage) => void;
	onReply?: (message: ThreadUiMessage) => void;
	onJumpToMessage?: (messageId: string) => void;
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	emptyTitle: string;
	emptySubtitle: string;
	highlightedMessageId?: string | null;
}) {
	if (isLoading) {
		return (
			<div className="h-full flex items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-slate-700" />
			</div>
		);
	}

	if (!hasMessages) {
		return (
			<div className="h-full flex flex-col items-center justify-center text-center px-6">
				<h3 className="text-base font-semibold text-slate-900 md:text-xl">
					{emptyTitle}
				</h3>
				<p className="mt-2 text-xs text-slate-500 md:text-sm">
					{emptySubtitle}
				</p>
			</div>
		);
	}

	const blocks = buildThreadBlocks(messages, senderMap);
	const getSenderName = (userId: string) => senderMap[userId]?.name;

	return (
		<div className="w-full min-w-0 overflow-x-hidden">
			{hasNextPage && isFetchingNextPage && (
				<div className="space-y-2 pb-2">
					{Array.from({ length: 6 }).map((_, index) => {
						const mine = index % 3 === 2;
						return (
							<div
								key={`thread-skeleton-${index}`}
								className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}
							>
								{!mine && (
									<div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-slate-200" />
								)}
								<div
									className={`h-8 animate-pulse rounded-2xl bg-slate-200 ${
										mine ? "w-40" : "w-56"
									}`}
								/>
							</div>
						);
					})}
				</div>
			)}

			<div className="mt-2.5">
				{blocks.map((block) => {
					if (block.type === "date_separator") {
						return (
							<ThreadDateSeparator key={block.key} label={block.dateLabel} />
						);
					}

					if (block.type === "gap_separator") {
						return (
							<ThreadGapSeparator key={block.key} label={block.gapLabel} />
						);
					}

					return (
						<ThreadMessageGroup
							key={block.key}
							group={block}
							isSelected={selectedSenderId === block.senderId}
							currentUserId={currentUserId}
							highlightedMessageId={highlightedMessageId}
							editingMessageId={editingMessageId}
							getSenderName={getSenderName}
							onSelectSender={onSelectSender}
							onToggleReaction={onToggleReaction}
							onRequestUnsend={onRequestUnsend}
							onStartEdit={onStartEdit}
							onSubmitEdit={onSubmitEdit}
							onCancelEdit={onCancelEdit}
							onCopy={onCopy}
							onReply={onReply}
							onJumpToMessage={onJumpToMessage}
						/>
					);
				})}
			</div>
		</div>
	);
}
