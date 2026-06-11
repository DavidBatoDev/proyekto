import { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useDeleteRoadmapAiSession,
  useRoadmapAiSessionsList,
  useUpdateRoadmapAiSession,
} from "@/hooks/useRoadmapAiSessions";
import type { RoadmapAiSession } from "@/services/roadmap-ai-sessions.service";

interface RoadmapAiThreadListProps {
  roadmapId: string;
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onCreateNewThread: () => void | Promise<void>;
  onClose: () => void;
}

// Popover content for the thread picker. Consumes the list query directly so
// the panel only wires the trigger button + open/close state. Supports:
// - filter between active and archived tabs
// - text search by title / first-user-message-fallback label
// - inline rename (double-click title or use row menu)
// - pin / unpin, archive / restore, hard delete (with confirm)
export function RoadmapAiThreadList({
  roadmapId,
  activeThreadId,
  onSelectThread,
  onCreateNewThread,
  onClose,
}: RoadmapAiThreadListProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const listQuery = useRoadmapAiSessionsList(roadmapId, {
    archived: showArchived,
  });
  const updateMutation = useUpdateRoadmapAiSession(roadmapId);
  const deleteMutation = useDeleteRoadmapAiSession(roadmapId);

  const filtered = useMemo(() => {
    const sessions = listQuery.data ?? [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return sessions;
    return sessions.filter((s) => {
      const title = (s.title ?? "").toLowerCase();
      return title.includes(term);
    });
  }, [listQuery.data, searchTerm]);

  const { pinned, unpinned } = useMemo(() => {
    const pinnedItems: RoadmapAiSession[] = [];
    const otherItems: RoadmapAiSession[] = [];
    for (const session of filtered) {
      if (session.is_pinned) pinnedItems.push(session);
      else otherItems.push(session);
    }
    return { pinned: pinnedItems, unpinned: otherItems };
  }, [filtered]);

  const startRename = (session: RoadmapAiSession) => {
    setRenameId(session.id);
    setRenameDraft(session.title ?? "");
    setMenuOpenId(null);
  };

  const submitRename = () => {
    const trimmed = renameDraft.trim();
    if (!renameId || !trimmed) {
      setRenameId(null);
      return;
    }
    updateMutation.mutate({
      sessionId: renameId,
      payload: { title: trimmed.slice(0, 120) },
    });
    setRenameId(null);
  };

  const togglePin = (session: RoadmapAiSession) => {
    updateMutation.mutate({
      sessionId: session.id,
      payload: { is_pinned: !session.is_pinned },
    });
    setMenuOpenId(null);
  };

  const toggleArchive = (session: RoadmapAiSession) => {
    updateMutation.mutate({
      sessionId: session.id,
      payload: { is_archived: !session.is_archived },
    });
    setMenuOpenId(null);
  };

  const confirmDelete = (sessionId: string) => {
    deleteMutation.mutate(sessionId, {
      onSuccess: () => {
        setConfirmDeleteId(null);
      },
    });
  };

  const pendingDeleteSession = useMemo(() => {
    if (!confirmDeleteId) return null;
    return (
      (listQuery.data ?? []).find((s) => s.id === confirmDeleteId) ?? null
    );
  }, [confirmDeleteId, listQuery.data]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.15 }}
      className="absolute right-0 top-full mt-1 z-40 flex max-h-[min(70vh,520px)] w-[320px] flex-col rounded-lg border border-slate-800 bg-slate-900 shadow-xl"
      role="dialog"
      aria-label="AI thread picker"
    >
      <div className="flex shrink-0 border-b border-slate-800">
        <button
          type="button"
          onClick={() => setShowArchived(false)}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            !showArchived
              ? "bg-slate-900 text-slate-100 border-b-2 border-blue-400"
              : "bg-slate-900 text-slate-400 hover:text-slate-200"
          }`}
        >
          Threads
        </button>
        <button
          type="button"
          onClick={() => setShowArchived(true)}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            showArchived
              ? "bg-slate-900 text-slate-100 border-b-2 border-blue-400"
              : "bg-slate-900 text-slate-400 hover:text-slate-200"
          }`}
        >
          Archived
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-2 text-slate-500 hover:text-slate-300"
          aria-label="Close thread picker"
        >
          <X size={14} />
        </button>
      </div>

      <div className="shrink-0 px-2 pt-2 pb-1">
        <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-2 py-1">
          <Search size={13} className="text-slate-500 shrink-0" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search threads..."
            className="flex-1 bg-transparent text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
          />
        </div>
      </div>

      {/* The list scrolls; tabs, search, and the New-thread footer stay
          pinned so the primary action is always reachable. */}
      <div className="flex-1 overflow-y-auto overscroll-contain py-1">
        {listQuery.isLoading && (
          <div className="px-3 py-6 text-center text-xs text-slate-500">
            Loading…
          </div>
        )}
        {!listQuery.isLoading && filtered.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-slate-500">
              {showArchived
                ? "No archived threads"
                : searchTerm.trim()
                  ? "No threads match your search"
                  : "No threads yet"}
            </p>
            {!showArchived && !searchTerm.trim() && (
              <button
                type="button"
                onClick={() => {
                  void onCreateNewThread();
                  onClose();
                }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800/60"
              >
                <Plus size={13} />
                Start your first thread
              </button>
            )}
          </div>
        )}
        {pinned.length > 0 && (
          <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Pinned
          </div>
        )}
        {pinned.map((session) => (
          <ThreadRow
            key={session.id}
            session={session}
            active={session.id === activeThreadId}
            renaming={renameId === session.id}
            renameDraft={renameDraft}
            menuOpen={menuOpenId === session.id}
            onRenameDraftChange={setRenameDraft}
            onStartRename={() => startRename(session)}
            onSubmitRename={submitRename}
            onCancelRename={() => setRenameId(null)}
            onToggleMenu={() =>
              setMenuOpenId(menuOpenId === session.id ? null : session.id)
            }
            onTogglePin={() => togglePin(session)}
            onToggleArchive={() => toggleArchive(session)}
            onRequestDelete={() => {
              setConfirmDeleteId(session.id);
              setMenuOpenId(null);
            }}
            onSelect={() => {
              onSelectThread(session.id);
              onClose();
            }}
          />
        ))}
        {pinned.length > 0 && unpinned.length > 0 && (
          <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Recent
          </div>
        )}
        {unpinned.map((session) => (
          <ThreadRow
            key={session.id}
            session={session}
            active={session.id === activeThreadId}
            renaming={renameId === session.id}
            renameDraft={renameDraft}
            menuOpen={menuOpenId === session.id}
            onRenameDraftChange={setRenameDraft}
            onStartRename={() => startRename(session)}
            onSubmitRename={submitRename}
            onCancelRename={() => setRenameId(null)}
            onToggleMenu={() =>
              setMenuOpenId(menuOpenId === session.id ? null : session.id)
            }
            onTogglePin={() => togglePin(session)}
            onToggleArchive={() => toggleArchive(session)}
            onRequestDelete={() => {
              setConfirmDeleteId(session.id);
              setMenuOpenId(null);
            }}
            onSelect={() => {
              onSelectThread(session.id);
              onClose();
            }}
          />
        ))}
      </div>

      <div className="shrink-0 border-t border-slate-800 p-2">
        <button
          type="button"
          onClick={() => {
            void onCreateNewThread();
            onClose();
          }}
          className="gemini-gradient-bg flex w-full items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          <Plus size={14} />
          New thread
        </button>
      </div>

      <DeleteThreadConfirmModal
        session={pendingDeleteSession}
        isDeleting={deleteMutation.isPending}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteSession) confirmDelete(pendingDeleteSession.id);
        }}
      />
    </motion.div>
  );
}

interface ThreadRowProps {
  session: RoadmapAiSession;
  active: boolean;
  renaming: boolean;
  renameDraft: string;
  menuOpen: boolean;
  onRenameDraftChange: (value: string) => void;
  onStartRename: () => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onToggleMenu: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onRequestDelete: () => void;
  onSelect: () => void;
}

function ThreadRow({
  session,
  active,
  renaming,
  renameDraft,
  menuOpen,
  onRenameDraftChange,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onToggleMenu,
  onTogglePin,
  onToggleArchive,
  onRequestDelete,
  onSelect,
}: ThreadRowProps) {
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  // The action menu renders through a portal with fixed positioning: the
  // thread list is a scroll container, so an absolutely-positioned dropdown
  // would be clipped at its bounds (worst at the last visible row).
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    right: number;
    openUp: boolean;
  } | null>(null);
  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);
  useEffect(() => {
    if (!menuOpen) {
      setMenuPosition(null);
      return;
    }
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const MENU_HEIGHT = 150;
    const openUp = rect.bottom + MENU_HEIGHT > window.innerHeight;
    setMenuPosition({
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      right: window.innerWidth - rect.right,
      openUp,
    });
  }, [menuOpen]);

  const displayTitle = session.title?.trim() || "New thread";
  const timeLabel = formatRelativeTime(
    session.last_message_at ?? session.created_at,
  );

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors ${
        active
          ? "bg-blue-950/40 text-blue-200"
          : "text-slate-200 hover:bg-slate-800/60"
      }`}
      onClick={() => !renaming && onSelect()}
    >
      <MessageSquare
        size={13}
        className={active ? "text-blue-400" : "text-slate-500"}
      />
      <div className="flex-1 min-w-0">
        {renaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameDraft}
            onChange={(e) => onRenameDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmitRename();
              if (e.key === "Escape") onCancelRename();
            }}
            onBlur={onSubmitRename}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-slate-900 border border-blue-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:border-blue-400"
            maxLength={120}
          />
        ) : (
          <div
            className="truncate"
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartRename();
            }}
            title={displayTitle}
          >
            {displayTitle}
          </div>
        )}
      </div>
      <span className="shrink-0 text-[10px] text-slate-500">{timeLabel}</span>
      {session.is_pinned && (
        <Pin size={11} className="shrink-0 text-slate-500" />
      )}
      <div
        className="relative shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onToggleMenu}
          className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          aria-label="Thread actions"
        >
          <MoreHorizontal size={12} />
        </button>
        {menuOpen &&
          menuPosition &&
          createPortal(
            <div
              className="fixed inset-0 z-[150]"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMenu();
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.1 }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  top: menuPosition.openUp ? undefined : menuPosition.top,
                  bottom: menuPosition.openUp
                    ? window.innerHeight - menuPosition.top
                    : undefined,
                  right: menuPosition.right,
                }}
                className="fixed w-40 rounded-md border border-slate-800 bg-slate-900 py-1 shadow-lg"
              >
                <MenuItem onClick={onStartRename} icon={<Pencil size={12} />}>
                  Rename
                </MenuItem>
                <MenuItem
                  onClick={onTogglePin}
                  icon={
                    session.is_pinned ? (
                      <PinOff size={12} />
                    ) : (
                      <Pin size={12} />
                    )
                  }
                >
                  {session.is_pinned ? "Unpin" : "Pin"}
                </MenuItem>
                <MenuItem
                  onClick={onToggleArchive}
                  icon={
                    session.is_archived ? (
                      <ArchiveRestore size={12} />
                    ) : (
                      <Archive size={12} />
                    )
                  }
                >
                  {session.is_archived ? "Restore" : "Archive"}
                </MenuItem>
                <MenuItem
                  onClick={onRequestDelete}
                  icon={<Trash2 size={12} />}
                  destructive
                >
                  Delete
                </MenuItem>
              </motion.div>
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
}

function DeleteThreadConfirmModal({
  session,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  session: RoadmapAiSession | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isOpen = session !== null;
  const displayTitle = session?.title?.trim() || "New thread";

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[180] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <motion.button
            type="button"
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            onClick={onCancel}
            aria-label="Cancel delete"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-thread-title"
            className="relative w-full max-w-md rounded-2xl border border-red-900/50 bg-slate-900 shadow-[0_24px_80px_rgba(0,0,0,0.6)] overflow-hidden"
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <div className="flex items-center gap-3 border-b border-red-900/50 bg-gradient-to-r from-red-950/60 to-rose-950/40 px-5 py-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-950/400 text-white shadow-sm">
                <Trash2 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h3
                  id="delete-thread-title"
                  className="text-base font-semibold text-slate-900"
                >
                  Delete thread
                </h3>
                <p className="text-xs text-slate-600">
                  This will permanently remove the thread and its messages.
                </p>
              </div>
              <button
                type="button"
                onClick={onCancel}
                disabled={isDeleting}
                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-60"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 text-sm text-slate-700">
              Are you sure you want to delete{" "}
              <span className="font-semibold text-slate-900">
                “{displayTitle}”
              </span>
              ? This action cannot be undone.
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-900/70 px-5 py-4">
              <button
                type="button"
                onClick={onCancel}
                disabled={isDeleting}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={isDeleting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-950/400 disabled:opacity-60"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function MenuItem({
  onClick,
  icon,
  destructive,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-2 py-1.5 text-xs ${
        destructive
          ? "text-red-400 hover:bg-red-950/40"
          : "text-slate-300 hover:bg-slate-800"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function formatRelativeTime(isoString: string): string {
  try {
    const then = new Date(isoString).getTime();
    if (!Number.isFinite(then)) return "";
    const deltaMs = Date.now() - then;
    const minutes = Math.floor(deltaMs / 60_000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo`;
    return `${Math.floor(days / 365)}y`;
  } catch {
    return "";
  }
}
