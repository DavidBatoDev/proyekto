import { AnimatePresence, motion } from "framer-motion";
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
import {
	type RefObject,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	useAiSessionsList,
	useDeleteAiSession,
	useUpdateAiSession,
} from "@/hooks/useAiSessions";
import type { AiSession } from "@/services/ai-sessions.service";
import type { AiSessionScope } from "./scope";

interface AiThreadListProps {
	scope: AiSessionScope;
	activeThreadId: string | null;
	// The trigger button the popover anchors to. The popover is portaled to
	// <body> (fixed positioning) so the panel's `overflow-hidden` can't clip it
	// -- which previously hid/disabled the "New thread" footer button.
	anchorRef: RefObject<HTMLElement | null>;
	onSelectThread: (threadId: string) => void;
	onCreateNewThread: () => void | Promise<void>;
	onClose: () => void;
	/** After a hard delete succeeded (the panel tears down that thread's run). */
	onDeleted?: (threadId: string) => void;
}

// Popover content for the thread picker. Consumes the list query directly so
// the panel only wires the trigger button + open/close state. Supports:
// - filter between active and archived tabs
// - text search by title / first-user-message-fallback label
// - inline rename (double-click title or use row menu)
// - pin / unpin, archive / restore, hard delete (with confirm)
//
// Styled with theme tokens only: it is a portaled popover that floats over
// whichever surface hosts the panel (the roadmap page, the dashboard's
// `bg-sidebar` rail), in light and dark mode.
export function AiThreadList({
	scope,
	activeThreadId,
	anchorRef,
	onSelectThread,
	onCreateNewThread,
	onClose,
	onDeleted,
}: AiThreadListProps) {
	// Fixed position computed from the trigger's viewport rect (the popover is
	// portaled out of the panel, so it can't use `top-full`/`right-0` anymore).
	const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
	useLayoutEffect(() => {
		const compute = () => {
			const rect = anchorRef.current?.getBoundingClientRect();
			if (!rect) return;
			setPos({
				top: rect.bottom + 6,
				right: Math.max(8, window.innerWidth - rect.right),
			});
		};
		compute();
		window.addEventListener("resize", compute);
		window.addEventListener("scroll", compute, true);
		return () => {
			window.removeEventListener("resize", compute);
			window.removeEventListener("scroll", compute, true);
		};
	}, [anchorRef]);

	const [showArchived, setShowArchived] = useState(false);
	const [searchTerm, setSearchTerm] = useState("");
	const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
	const [renameId, setRenameId] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState("");
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

	const listQuery = useAiSessionsList(scope, {
		archived: showArchived,
	});
	const updateMutation = useUpdateAiSession(scope);
	const deleteMutation = useDeleteAiSession(scope);

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
		const pinnedItems: AiSession[] = [];
		const otherItems: AiSession[] = [];
		for (const session of filtered) {
			if (session.is_pinned) pinnedItems.push(session);
			else otherItems.push(session);
		}
		return { pinned: pinnedItems, unpinned: otherItems };
	}, [filtered]);

	const startRename = (session: AiSession) => {
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

	const togglePin = (session: AiSession) => {
		updateMutation.mutate({
			sessionId: session.id,
			payload: { is_pinned: !session.is_pinned },
		});
		setMenuOpenId(null);
	};

	const toggleArchive = (session: AiSession) => {
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
				onDeleted?.(sessionId);
			},
		});
	};

	const pendingDeleteSession = useMemo(() => {
		if (!confirmDeleteId) return null;
		return (listQuery.data ?? []).find((s) => s.id === confirmDeleteId) ?? null;
	}, [confirmDeleteId, listQuery.data]);

	const tabClass = (active: boolean) =>
		`flex-1 py-2 text-xs font-medium transition-colors ${
			active
				? "bg-popover text-popover-foreground border-b-2 border-primary"
				: "bg-muted text-muted-foreground hover:text-foreground"
		}`;

	return createPortal(
		<>
			<div
				className="fixed inset-0 z-[115]"
				onClick={onClose}
				aria-hidden="true"
			/>
			<motion.div
				initial={{ opacity: 0, y: -6 }}
				animate={{ opacity: 1, y: 0 }}
				exit={{ opacity: 0, y: -6 }}
				transition={{ duration: 0.15 }}
				style={
					pos
						? { top: pos.top, right: pos.right }
						: { top: -9999, right: 0, visibility: "hidden" }
				}
				className="fixed z-[120] flex max-h-[min(70vh,520px)] w-[320px] flex-col rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
				role="dialog"
				aria-label="AI thread picker"
			>
				<div className="flex shrink-0 border-b border-border">
					<button
						type="button"
						onClick={() => setShowArchived(false)}
						className={tabClass(!showArchived)}
					>
						Threads
					</button>
					<button
						type="button"
						onClick={() => setShowArchived(true)}
						className={tabClass(showArchived)}
					>
						Archived
					</button>
					<button
						type="button"
						onClick={onClose}
						className="px-2 text-muted-foreground hover:text-foreground"
						aria-label="Close thread picker"
					>
						<X size={14} />
					</button>
				</div>

				<div className="shrink-0 px-2 pt-2 pb-1">
					<div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1">
						<Search size={13} className="text-muted-foreground shrink-0" />
						<input
							type="text"
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							placeholder="Search threads..."
							className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
						/>
					</div>
				</div>

				{/* The list scrolls; tabs, search, and the New-thread footer stay
          pinned so the primary action is always reachable. */}
				<div className="flex-1 overflow-y-auto overscroll-contain py-1">
					{listQuery.isLoading && (
						<div className="px-3 py-6 text-center text-xs text-muted-foreground">
							Loading…
						</div>
					)}
					{!listQuery.isLoading && filtered.length === 0 && (
						<div className="px-3 py-6 text-center">
							<p className="text-xs text-muted-foreground">
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
									className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
								>
									<Plus size={13} />
									Start your first thread
								</button>
							)}
						</div>
					)}
					{pinned.length > 0 && (
						<div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
						<div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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

				<div className="shrink-0 border-t border-border p-2">
					<button
						type="button"
						onClick={() => {
							void onCreateNewThread();
							onClose();
						}}
						className="flex w-full items-center justify-center gap-2 ai-gradient-bg rounded-md px-2 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
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
		</>,
		document.body,
	);
}

interface ThreadRowProps {
	session: AiSession;
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
					? "bg-primary/10 text-primary"
					: "text-popover-foreground hover:bg-accent"
			}`}
			onClick={() => !renaming && onSelect()}
		>
			<MessageSquare
				size={13}
				className={active ? "text-primary" : "text-muted-foreground"}
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
						className="w-full bg-background text-foreground border border-primary/40 rounded px-1 py-0.5 text-xs focus:outline-none focus:border-primary"
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
			<span className="shrink-0 text-[10px] text-muted-foreground">
				{timeLabel}
			</span>
			{session.is_pinned && (
				<Pin size={11} className="shrink-0 text-muted-foreground" />
			)}
			<div
				className="relative shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100"
				onClick={(e) => e.stopPropagation()}
			>
				<button
					ref={menuButtonRef}
					type="button"
					onClick={onToggleMenu}
					className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
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
								className="fixed w-40 rounded-md border border-border bg-popover text-popover-foreground py-1 shadow-lg"
							>
								<MenuItem onClick={onStartRename} icon={<Pencil size={12} />}>
									Rename
								</MenuItem>
								<MenuItem
									onClick={onTogglePin}
									icon={
										session.is_pinned ? <PinOff size={12} /> : <Pin size={12} />
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
	session: AiSession | null;
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
						className="relative w-full max-w-md rounded-2xl border border-destructive/20 bg-card text-card-foreground shadow-2xl overflow-hidden"
						initial={{ opacity: 0, y: 14, scale: 0.97 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: 10, scale: 0.97 }}
						transition={{ duration: 0.22, ease: "easeOut" }}
					>
						<div className="flex items-center gap-3 border-b border-destructive/20 bg-destructive/10 px-5 py-4">
							<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive text-white shadow-sm">
								<Trash2 className="h-4 w-4" />
							</span>
							<div className="min-w-0">
								<h3
									id="delete-thread-title"
									className="text-base font-semibold text-card-foreground"
								>
									Delete thread
								</h3>
								<p className="text-xs text-muted-foreground">
									This will permanently remove the thread and its messages.
								</p>
							</div>
							<button
								type="button"
								onClick={onCancel}
								disabled={isDeleting}
								className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
								aria-label="Close"
							>
								<X className="w-4 h-4" />
							</button>
						</div>

						<div className="px-5 py-4 text-sm text-card-foreground">
							Are you sure you want to delete{" "}
							<span className="font-semibold">“{displayTitle}”</span>? This
							action cannot be undone.
						</div>

						<div className="flex items-center justify-end gap-2 border-t border-border bg-muted/60 px-5 py-4">
							<button
								type="button"
								onClick={onCancel}
								disabled={isDeleting}
								className="rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-card-foreground hover:bg-accent disabled:opacity-60"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={onConfirm}
								disabled={isDeleting}
								className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-white hover:bg-destructive/90 disabled:opacity-60"
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
					? "text-destructive hover:bg-destructive/10"
					: "text-popover-foreground hover:bg-accent"
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
