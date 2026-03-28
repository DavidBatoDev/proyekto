import type { ChatMessage } from "@/services/chat.service";

export type ThreadUiMessage = ChatMessage & {
  optimisticStatus?: "sending" | "failed";
  render_key?: string;
  optimistic_order?: number;
};

const DEFAULT_OPTIMISTIC_MATCH_WINDOW_MS = 15_000;

export type ThreadSender = {
  name: string;
  avatarUrl?: string | null;
};

export type ThreadMessageGroup = {
  type: "message_group";
  key: string;
  senderId: string;
  sender: ThreadSender;
  startedAt: string;
  messages: ThreadUiMessage[];
};

export type ThreadDateSeparator = {
  type: "date_separator";
  key: string;
  dateLabel: string;
};

export type ThreadGapSeparator = {
  type: "gap_separator";
  key: string;
  gapLabel: string;
};

export type ThreadRenderBlock =
  | ThreadDateSeparator
  | ThreadGapSeparator
  | ThreadMessageGroup;

const SAME_SENDER_GROUP_WINDOW_MS = 5 * 60 * 1000;
const GAP_SEPARATOR_MS = 2 * 60 * 60 * 1000;

function parseMessageTime(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function threadMessageStableKey(message: ThreadUiMessage): string {
  return message.render_key ?? message.id;
}

export function compareThreadMessages(
  a: ThreadUiMessage,
  b: ThreadUiMessage,
): number {
  const createdDiff = parseMessageTime(a.created_at) - parseMessageTime(b.created_at);
  if (createdDiff !== 0) return createdDiff;

  const aOrder = a.optimistic_order ?? 0;
  const bOrder = b.optimistic_order ?? 0;
  if (aOrder !== bOrder) return aOrder - bOrder;

  return threadMessageStableKey(a).localeCompare(threadMessageStableKey(b));
}

export function sortThreadMessages(
  inputMessages: ThreadUiMessage[],
): ThreadUiMessage[] {
  return [...inputMessages].sort(compareThreadMessages);
}

export function mergeThreadMessages(
  confirmedMessages: ThreadUiMessage[],
  optimisticMessages: ThreadUiMessage[],
  options?: { optimisticMatchWindowMs?: number },
): ThreadUiMessage[] {
  const matchWindowMs =
    options?.optimisticMatchWindowMs ?? DEFAULT_OPTIMISTIC_MATCH_WINDOW_MS;

  const hasConfirmedMatchForOptimistic = (optimistic: ThreadUiMessage) => {
    if (optimistic.optimisticStatus !== "sending") return false;
    const optimisticTime = parseMessageTime(optimistic.created_at);

    return confirmedMessages.some((confirmed) => {
      if (confirmed.sender_id !== optimistic.sender_id) return false;
      if (confirmed.content !== optimistic.content) return false;
      const confirmedTime = parseMessageTime(confirmed.created_at);
      return Math.abs(confirmedTime - optimisticTime) <= matchWindowMs;
    });
  };

  const byId = new Map<string, ThreadUiMessage>();
  for (const message of confirmedMessages) {
    byId.set(message.id, message);
  }

  for (const message of optimisticMessages) {
    if (hasConfirmedMatchForOptimistic(message)) continue;
    if (byId.has(message.id)) continue;
    byId.set(message.id, message);
  }

  return sortThreadMessages(Array.from(byId.values()));
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString([], {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatGapLabel(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function buildThreadBlocks(
  inputMessages: ThreadUiMessage[],
  senderMap: Record<string, ThreadSender>,
): ThreadRenderBlock[] {
  const renderKeyFor = (message: ThreadUiMessage) => threadMessageStableKey(message);
  const messages = sortThreadMessages(inputMessages);

  const blocks: ThreadRenderBlock[] = [];
  let currentGroup: ThreadMessageGroup | null = null;
  let lastMessageDate: Date | null = null;

  const flushGroup = () => {
    if (currentGroup) {
      blocks.push(currentGroup);
      currentGroup = null;
    }
  };

  for (const message of messages) {
    const messageDate = new Date(message.created_at);

    if (!lastMessageDate || !isSameDay(lastMessageDate, messageDate)) {
      flushGroup();
      blocks.push({
        type: "date_separator",
        key: `date-${messageDate.toISOString()}`,
        dateLabel: formatDateLabel(messageDate),
      });
    } else if (messageDate.getTime() - lastMessageDate.getTime() > GAP_SEPARATOR_MS) {
      flushGroup();
      blocks.push({
        type: "gap_separator",
        key: `gap-${renderKeyFor(message)}`,
        gapLabel: formatGapLabel(messageDate),
      });
    }

    const latestGroupMessage =
      currentGroup && currentGroup.messages.length > 0
        ? currentGroup.messages[currentGroup.messages.length - 1]
        : null;
    const canJoinExistingGroup =
      !!currentGroup &&
      !!latestGroupMessage &&
      currentGroup.senderId === message.sender_id &&
      messageDate.getTime() -
        new Date(latestGroupMessage.created_at).getTime() <=
        SAME_SENDER_GROUP_WINDOW_MS;

    if (!canJoinExistingGroup) {
      flushGroup();
      const sender = senderMap[message.sender_id] ?? {
        name: "Unknown member",
        avatarUrl: null,
      };

      currentGroup = {
        type: "message_group",
        key: `group-${renderKeyFor(message)}`,
        senderId: message.sender_id,
        sender,
        startedAt: message.created_at,
        messages: [message],
      };
    } else if (currentGroup) {
      currentGroup.messages.push(message);
    }

    lastMessageDate = messageDate;
  }

  flushGroup();
  return blocks;
}
