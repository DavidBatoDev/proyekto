import type { ReactNode } from "react";
import type { ChatMention } from "@/services/chat.service";

/** Sentinel `user_id` for an @everyone mention (pings all room members). */
export const EVERYONE_MENTION_ID = "everyone";

/** A mention the user picked in the composer, before it's resolved to a span. */
export interface MentionPick {
  user_id: string;
  name: string;
}

/**
 * Resolve composer picks into `ChatMention` spans against the final (trimmed)
 * content that will be sent. For each pick we claim the first unclaimed
 * `@Name` occurrence; picks whose text was edited away are dropped. Computed
 * once at send — no live offset bookkeeping.
 */
export function resolveMentions(
  content: string,
  picks: MentionPick[],
): ChatMention[] {
  const claimed = new Set<number>();
  const out: ChatMention[] = [];

  for (const pick of picks) {
    const token = `@${pick.name}`;
    let from = 0;
    while (from <= content.length) {
      const idx = content.indexOf(token, from);
      if (idx === -1) break;
      if (!claimed.has(idx)) {
        claimed.add(idx);
        out.push({
          user_id: pick.user_id,
          name: pick.name,
          offset: idx,
          length: token.length,
        });
        break;
      }
      from = idx + 1;
    }
  }

  return out.sort((a, b) => a.offset - b.offset);
}

/** True when `mentions` ping the viewer (directly or via @everyone). */
export function mentionsCurrentUser(
  mentions: ChatMention[] | undefined,
  currentUserId: string | undefined,
): boolean {
  if (!mentions?.length) return false;
  return mentions.some(
    (m) =>
      m.user_id === EVERYONE_MENTION_ID ||
      (!!currentUserId && m.user_id === currentUserId),
  );
}

/**
 * Render message content with `@Name` runs turned into mention chips. Falls back
 * to the raw string when there are no (valid) mention spans, so callers can use
 * it unconditionally.
 */
export function renderMentionContent(
  content: string,
  mentions: ChatMention[] | undefined,
  opts?: { currentUserId?: string },
): ReactNode {
  if (!mentions?.length) return content;

  // Keep only in-bounds, non-overlapping spans, left to right.
  const spans = [...mentions]
    .filter(
      (m) =>
        Number.isInteger(m.offset) &&
        Number.isInteger(m.length) &&
        m.offset >= 0 &&
        m.length > 0 &&
        m.offset + m.length <= content.length,
    )
    .sort((a, b) => a.offset - b.offset);

  if (spans.length === 0) return content;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, index) => {
    if (span.offset < cursor) return; // skip overlap
    if (span.offset > cursor) {
      nodes.push(content.slice(cursor, span.offset));
    }
    const text = content.slice(span.offset, span.offset + span.length);
    const isSelf =
      span.user_id === EVERYONE_MENTION_ID ||
      (!!opts?.currentUserId && span.user_id === opts.currentUserId);
    nodes.push(
      <span
        key={`mention-${index}-${span.offset}`}
        className={`rounded px-1 font-medium ${
          isSelf
            ? "bg-violet-600 text-white"
            : "bg-violet-100 text-violet-700"
        }`}
      >
        {text}
      </span>,
    );
    cursor = span.offset + span.length;
  });
  if (cursor < content.length) nodes.push(content.slice(cursor));

  return nodes;
}
