import { useCallback, useEffect, useState } from "react";
import type { MentionPick } from "@/components/project/chat/mentions";

/** A composer draft for one conversation: unsent text + the @mention picks. */
export interface ChatDraft {
  text: string;
  mentions: MentionPick[];
}

const EMPTY: ChatDraft = { text: "", mentions: [] };
const STORAGE_PREFIX = "chat.draft.";

const storageKey = (conversationKey: string) =>
  `${STORAGE_PREFIX}${conversationKey}`;

const readDraft = (conversationKey: string): ChatDraft => {
  if (typeof window === "undefined" || !conversationKey) return EMPTY;
  try {
    const raw = window.localStorage.getItem(storageKey(conversationKey));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<ChatDraft>;
    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      mentions: Array.isArray(parsed.mentions) ? parsed.mentions : [],
    };
  } catch {
    return EMPTY;
  }
};

const writeDraft = (conversationKey: string, draft: ChatDraft): void => {
  if (typeof window === "undefined" || !conversationKey) return;
  try {
    if (!draft.text && draft.mentions.length === 0) {
      window.localStorage.removeItem(storageKey(conversationKey));
    } else {
      window.localStorage.setItem(
        storageKey(conversationKey),
        JSON.stringify(draft),
      );
    }
  } catch {
    // ignore quota / unavailable storage
  }
};

/**
 * Per-conversation composer draft persisted to localStorage (Slack-style: drafts
 * survive a browser restart until sent/cleared). Switching `conversationKey`
 * returns that conversation's stored draft instantly (with a read() fallback so
 * there's no empty flash before the seeding effect runs). Setters write through
 * to localStorage so a refresh keeps the draft.
 */
export function useChatDraft(conversationKey: string) {
  const [drafts, setDrafts] = useState<Record<string, ChatDraft>>(() =>
    conversationKey ? { [conversationKey]: readDraft(conversationKey) } : {},
  );

  // Lazily seed each newly-opened conversation's draft into the map.
  useEffect(() => {
    setDrafts((prev) =>
      conversationKey in prev
        ? prev
        : { ...prev, [conversationKey]: readDraft(conversationKey) },
    );
  }, [conversationKey]);

  const current = drafts[conversationKey] ?? readDraft(conversationKey);

  const apply = useCallback(
    (mutate: (draft: ChatDraft) => ChatDraft) => {
      setDrafts((prev) => {
        const existing = prev[conversationKey] ?? readDraft(conversationKey);
        const next = mutate(existing);
        writeDraft(conversationKey, next);
        return { ...prev, [conversationKey]: next };
      });
    },
    [conversationKey],
  );

  const setText = useCallback(
    (text: string) => apply((draft) => ({ ...draft, text })),
    [apply],
  );

  const addMention = useCallback(
    (pick: MentionPick) =>
      apply((draft) => ({ ...draft, mentions: [...draft.mentions, pick] })),
    [apply],
  );

  const clear = useCallback(() => apply(() => EMPTY), [apply]);

  return {
    text: current.text,
    mentions: current.mentions,
    setText,
    addMention,
    clear,
  };
}
