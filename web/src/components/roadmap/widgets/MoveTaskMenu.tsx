import { ArrowRightLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/hooks/useToast";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type { RoadmapTask } from "@/types/roadmap";

const MENU_WIDTH = 260;

interface FeatureCandidate {
	id: string;
	title: string;
	epicTitle: string;
}

interface MoveTaskMenuProps {
	task: RoadmapTask;
	/** Trigger button classes — callers style it to match their row's icon buttons. */
	triggerClassName?: string;
	iconClassName?: string;
}

/**
 * "Move to..." picker for relocating a task to a different feature without
 * dragging — the canvas keeps task rows deliberately light (no per-row DnD),
 * and this is the only way to move a task there; everywhere else it's a
 * faster alternative to dragging.
 */
export function MoveTaskMenu({
	task,
	triggerClassName,
	iconClassName,
}: MoveTaskMenuProps) {
	const toast = useToast();
	const moveTaskBetweenFeatures = useRoadmapStore(
		(s) => s.moveTaskBetweenFeatures,
	);
	const [isOpen, setIsOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [isMoving, setIsMoving] = useState(false);
	const [position, setPosition] = useState({ top: 0, left: 0 });
	// Snapshot on open rather than a live store subscription — this button is
	// mounted once per task row, potentially dozens of times across a large
	// roadmap's canvas, and the canvas keeps task rows deliberately free of
	// per-row store subscriptions that would re-render on every unrelated edit.
	const [candidates, setCandidates] = useState<FeatureCandidate[]>([]);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return candidates;
		return candidates.filter(
			(c) =>
				c.title.toLowerCase().includes(q) ||
				c.epicTitle.toLowerCase().includes(q),
		);
	}, [candidates, search]);

	const updatePosition = () => {
		const rect = triggerRef.current?.getBoundingClientRect();
		if (!rect) return;
		const left = Math.max(
			8,
			Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
		);
		setPosition({ top: rect.bottom + 4, left });
	};

	useEffect(() => {
		if (!isOpen) return;
		updatePosition();

		const handlePointerDown = (event: MouseEvent) => {
			const target = event.target as globalThis.Node;
			if (
				!triggerRef.current?.contains(target) &&
				!menuRef.current?.contains(target)
			) {
				setIsOpen(false);
			}
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setIsOpen(false);
		};
		const handleReposition = () => updatePosition();

		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		window.addEventListener("scroll", handleReposition, true);
		window.addEventListener("resize", handleReposition);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("scroll", handleReposition, true);
			window.removeEventListener("resize", handleReposition);
		};
	}, [isOpen]);

	const handleSelect = async (target: FeatureCandidate) => {
		setIsMoving(true);
		try {
			const epics = useRoadmapStore.getState().epics;
			const targetFeature = epics
				.flatMap((e) => e.features ?? [])
				.find((f) => f.id === target.id);
			const orderedIds = [
				...(targetFeature?.tasks ?? []).map((t) => t.id),
				task.id,
			];
			await moveTaskBetweenFeatures(task.id, target.id, orderedIds);
			toast.success(`Moved "${task.title}" to "${target.title}"`);
			setIsOpen(false);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to move task",
			);
		} finally {
			setIsMoving(false);
		}
	};

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				disabled={isMoving}
				onClick={(e) => {
					e.stopPropagation();
					if (!isOpen) {
						setSearch("");
						const epics = useRoadmapStore.getState().epics;
						const list: FeatureCandidate[] = [];
						for (const epic of epics) {
							for (const feature of epic.features ?? []) {
								if (feature.id === task.feature_id) continue;
								list.push({
									id: feature.id,
									title: feature.title,
									epicTitle: epic.title,
								});
							}
						}
						setCandidates(list);
					}
					setIsOpen((prev) => !prev);
				}}
				title="Move to another feature"
				aria-label="Move to another feature"
				className={
					triggerClassName ?? "p-1 hover:bg-gray-100 rounded transition-colors"
				}
			>
				<ArrowRightLeft
					className={iconClassName ?? "w-3.5 h-3.5 text-gray-500"}
				/>
			</button>

			{isOpen &&
				createPortal(
					<div
						ref={menuRef}
						className="fixed z-300 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
						style={{
							top: position.top,
							left: position.left,
							width: MENU_WIDTH,
						}}
						onClick={(e) => e.stopPropagation()}
					>
						<div className="border-b border-border p-2">
							<div className="relative">
								<Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
								<input
									autoFocus
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									placeholder="Search features..."
									className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
								/>
							</div>
						</div>
						<div className="max-h-56 overflow-y-auto py-1">
							{filtered.length === 0 && (
								<p className="px-3 py-2 text-xs text-muted-foreground">
									No features found
								</p>
							)}
							{filtered.map((c) => (
								<button
									key={c.id}
									type="button"
									disabled={isMoving}
									onClick={() => void handleSelect(c)}
									className="w-full px-3 py-2 text-left text-xs transition-colors hover:bg-accent"
								>
									<div className="truncate font-medium">{c.title}</div>
									<div className="truncate text-[10px] text-muted-foreground">
										{c.epicTitle}
									</div>
								</button>
							))}
						</div>
					</div>,
					document.body,
				)}
		</>
	);
}
