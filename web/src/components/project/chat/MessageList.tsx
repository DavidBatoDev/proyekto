import { Loader2 } from "lucide-react";
import { TypingIndicator } from "./TypingIndicator";
import {
  buildThreadBlocks,
  type ThreadSender,
  type ThreadUiMessage,
} from "./thread";
import { ThreadDateSeparator } from "./ThreadDateSeparator";
import { ThreadGapSeparator } from "./ThreadGapSeparator";
import { ThreadMessageGroup } from "./ThreadMessageGroup";

export function MessageList({
  isLoading,
  hasMessages,
  messages,
  senderMap,
  selectedSenderId,
  onSelectSender,
  hasNextPage,
  isFetchingNextPage,
  emptyTitle,
  emptySubtitle,
  typingNames,
}: {
  isLoading: boolean;
  hasMessages: boolean;
  messages: ThreadUiMessage[];
  senderMap: Record<string, ThreadSender>;
  selectedSenderId?: string | null;
  onSelectSender?: (userId: string) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  emptyTitle: string;
  emptySubtitle: string;
  typingNames: string[];
}) {
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#ff9933]" />
      </div>
    );
  }

  if (!hasMessages) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <h3 className="text-xl font-semibold text-gray-900">{emptyTitle}</h3>
        <p className="mt-2 text-sm text-gray-500">{emptySubtitle}</p>
        <div className="mt-4">
          <TypingIndicator names={typingNames} />
        </div>
      </div>
    );
  }

  const blocks = buildThreadBlocks(messages, senderMap);

  return (
    <div className="max-w-4xl mx-auto">
      {hasNextPage && isFetchingNextPage && (
        <div className="space-y-3 pb-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={`thread-skeleton-${index}`} className="flex items-start gap-3 px-1">
              <div className="h-10 w-10 rounded-full bg-gray-200 animate-pulse shrink-0" />
              <div className="flex-1 min-w-0 space-y-2 pt-1">
                <div className="h-3 w-36 rounded bg-gray-200 animate-pulse" />
                <div className="h-3 w-[78%] rounded bg-gray-200 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2.5">
        {blocks.map((block) => {
          if (block.type === "date_separator") {
            return <ThreadDateSeparator key={block.key} label={block.dateLabel} />;
          }

          if (block.type === "gap_separator") {
            return <ThreadGapSeparator key={block.key} label={block.gapLabel} />;
          }

          return (
            <ThreadMessageGroup
              key={block.key}
              group={block}
              isSelected={selectedSenderId === block.senderId}
              onSelectSender={onSelectSender}
            />
          );
        })}
      </div>

      <div className="mt-3">
        <TypingIndicator names={typingNames} />
      </div>
    </div>
  );
}
