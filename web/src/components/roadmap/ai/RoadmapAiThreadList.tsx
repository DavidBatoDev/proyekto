import { useMemo, useRef, useState, useEffect } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
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
        if (sessionId === activeThreadId) {
          // Caller will handle switching away; we just close the confirm.
        }
      },
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.15 }}
      className="absolute right-0 top-full mt-1 z-40 w-[320px] rounded-lg border border-gray-200 bg-white shadow-xl"
      role="dialog"
      aria-label="AI thread picker"
    >
      <div className="flex border-b border-gray-200">
        <button
          type="button"
          onClick={() => setShowArchived(false)}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            !showArchived
              ? "bg-white text-gray-900 border-b-2 border-blue-500"
              : "bg-gray-50 text-gray-500 hover:text-gray-700"
          }`}
        >
          Local
        </button>
        <button
          type="button"
          onClick={() => setShowArchived(true)}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            showArchived
              ? "bg-white text-gray-900 border-b-2 border-blue-500"
              : "bg-gray-50 text-gray-500 hover:text-gray-700"
          }`}
        >
          Archived
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-2 text-gray-400 hover:text-gray-600"
          aria-label="Close thread picker"
        >
          <X size={14} />
        </button>
      </div>

      <div className="px-2 pt-2 pb-1">
        <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1">
          <Search size={13} className="text-gray-400 shrink-0" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search sessions..."
            className="flex-1 bg-transparent text-xs text-gray-800 placeholder:text-gray-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="py-1">
        {listQuery.isLoading && (
          <div className="px-3 py-6 text-center text-xs text-gray-400">
            Loading…
          </div>
        )}
        {!listQuery.isLoading && filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-gray-400">
            {showArchived ? "No archived threads" : "No threads yet"}
          </div>
        )}
        {pinned.length > 0 && (
          <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
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
            confirmingDelete={confirmDeleteId === session.id}
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
            onCancelDelete={() => setConfirmDeleteId(null)}
            onConfirmDelete={() => confirmDelete(session.id)}
            onSelect={() => {
              onSelectThread(session.id);
              onClose();
            }}
          />
        ))}
        {pinned.length > 0 && unpinned.length > 0 && (
          <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
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
            confirmingDelete={confirmDeleteId === session.id}
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
            onCancelDelete={() => setConfirmDeleteId(null)}
            onConfirmDelete={() => confirmDelete(session.id)}
            onSelect={() => {
              onSelectThread(session.id);
              onClose();
            }}
          />
        ))}
      </div>

      <div className="border-t border-gray-200 p-1">
        <button
          type="button"
          onClick={() => {
            void onCreateNewThread();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
        >
          <Plus size={14} />
          New thread
        </button>
      </div>
    </motion.div>
  );
}

interface ThreadRowProps {
  session: RoadmapAiSession;
  active: boolean;
  renaming: boolean;
  renameDraft: string;
  menuOpen: boolean;
  confirmingDelete: boolean;
  onRenameDraftChange: (value: string) => void;
  onStartRename: () => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onToggleMenu: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onSelect: () => void;
}

function ThreadRow({
  session,
  active,
  renaming,
  renameDraft,
  menuOpen,
  confirmingDelete,
  onRenameDraftChange,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onToggleMenu,
  onTogglePin,
  onToggleArchive,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onSelect,
}: ThreadRowProps) {
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  const displayTitle = session.title?.trim() || "New thread";
  const timeLabel = formatRelativeTime(
    session.last_message_at ?? session.created_at,
  );

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors ${
        active
          ? "bg-blue-50 text-blue-900"
          : "text-gray-800 hover:bg-gray-50"
      }`}
      onClick={() => !renaming && !confirmingDelete && onSelect()}
    >
      <MessageSquare
        size={13}
        className={active ? "text-blue-500" : "text-gray-400"}
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
            className="w-full bg-white border border-blue-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:border-blue-500"
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
      <span className="shrink-0 text-[10px] text-gray-400">{timeLabel}</span>
      {session.is_pinned && (
        <Pin size={11} className="shrink-0 text-gray-400" />
      )}
      {confirmingDelete ? (
        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onConfirmDelete}
            className="rounded p-1 text-red-600 hover:bg-red-50"
            aria-label="Confirm delete"
          >
            <Check size={12} />
          </button>
          <button
            type="button"
            onClick={onCancelDelete}
            className="rounded p-1 text-gray-400 hover:bg-gray-100"
            aria-label="Cancel delete"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <div
          className="relative shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onToggleMenu}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Thread actions"
          >
            <MoreHorizontal size={12} />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.1 }}
                className="absolute right-0 top-full mt-1 z-50 w-40 rounded-md border border-gray-200 bg-white shadow-lg py-1"
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
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
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
          ? "text-red-600 hover:bg-red-50"
          : "text-gray-700 hover:bg-gray-100"
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
