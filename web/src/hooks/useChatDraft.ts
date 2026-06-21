import { useCallback, useEffect, useState } from "react";
import type { MentionPick } from "@/components/project/chat/mentions";

/** A composer draft for one conversation: unsent text + the @mention picks. */
export interface ChatDraft {
  text: string;
  mentions: MentionPick[];
}

const EMPTY: ChatDraft = { text: "", mentions: [] };
const STORAGE_PREFIX = "chat.draft.";
// Same-tab signal so other consumers (sidebar previews) re-read on any write.
const CHANGE_EVENT = "chat.draft.changed";

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
    window.dispatchEvent(
      new CustomEvent(CHANGE_EVENT, { detail: { conversationKey } }),
    );
  } catch {
    // ignore quota / unavailable storage
  }
};

/** Non-reactive read of just a conversation's draft text (for previews). */
export function readChatDraftText(conversationKey: string): string {
  return readDraft(conversationKey).text;
}

/**
 * Bumps whenever any chat draft changes (this tab or another), so a component
 * that renders draft previews via `readChatDraftText` re-reads. Cheap: a few
 * sidebar rows re-reading localStorage on keystroke.
 */
export function useChatDraftsVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((n) => n + 1);
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith(STORAGE_PREFIX)) bump();
    };
    window.addEventListener(CHANGE_EVENT, bump);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return version;
}

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
