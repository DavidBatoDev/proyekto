import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
	FileText,
	Folder,
	LayoutGrid,
	ListChecks,
	Map,
	ScrollText,
	Settings,
	Users,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Project } from "@/services/project.service";

const POPUP_CLOSE_DELAY_MS = 120;
const POPUP_GAP_PX = 6;
const VIEWPORT_MARGIN_PX = 8;

interface SubItem {
	label: string;
	icon: React.ElementType;
	to: string;
	matches: (currentPath: string, projectId: string) => boolean;
}

const SUB_ITEMS: SubItem[] = [
	{
		label: "Overview",
		icon: LayoutGrid,
		to: "/project/$projectId/overview",
		matches: (p, id) => p === `/project/${id}/overview`,
	},
	{
		label: "Roadmap",
		icon: Map,
		to: "/project/$projectId/roadmap",
		matches: (p, id) => p.startsWith(`/project/${id}/roadmap`),
	},
	{
		label: "Work items",
		icon: ListChecks,
		to: "/project/$projectId/work-items",
		matches: (p, id) => p.startsWith(`/project/${id}/work-items`),
	},
	{
		label: "Team",
		icon: Users,
		to: "/project/$projectId/team",
		matches: (p, id) => p.startsWith(`/project/${id}/team`),
	},
	{
		label: "Resources",
		icon: FileText,
		to: "/project/$projectId/resources",
		matches: (p, id) => p.startsWith(`/project/${id}/resources`),
	},
	{
		label: "Logs",
		icon: ScrollText,
		to: "/project/$projectId/logs",
		matches: (p, id) => p.startsWith(`/project/${id}/logs`),
	},
	{
		label: "Settings",
		icon: Settings,
		to: "/project/$projectId/settings",
		matches: (p, id) => p.startsWith(`/project/${id}/settings`),
	},
];

export function ProjectSidebarLink({
	project,
	currentPath,
}: {
	project: Project;
	currentPath: string;
}) {
	const active = currentPath.startsWith(`/project/${project.id}`);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	// We capture the trigger rect on hover so the popup can both
	// vertically-center on the trigger and clamp itself to the viewport
	// when there isn't enough room below.
	const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
	const closeTimer = useRef<number | null>(null);

	const cancelClose = () => {
		if (closeTimer.current !== null) {
			window.clearTimeout(closeTimer.current);
			closeTimer.current = null;
		}
	};
	const scheduleClose = () => {
		cancelClose();
		closeTimer.current = window.setTimeout(
			() => setOpen(false),
			POPUP_CLOSE_DELAY_MS,
		);
	};

	const onEnter = () => {
		cancelClose();
		const el = wrapperRef.current;
		if (el) setTriggerRect(el.getBoundingClientRect());
		setOpen(true);
	};

	useEffect(() => () => cancelClose(), []);

	return (
		<div
			ref={wrapperRef}
			className="relative"
			onMouseEnter={onEnter}
			onMouseLeave={scheduleClose}
		>
			<Link
				to="/project/$projectId/overview"
				params={{ projectId: project.id }}
				className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
					active
						? "bg-slate-900 text-white shadow-sm"
						: "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
				}`}
			>
				<Folder
					className={`h-5 w-5 shrink-0 ${
						active ? "text-white" : "text-slate-400"
					}`}
				/>
				<span className="truncate">
					{project.title || "Untitled project"}
				</span>
			</Link>

			{typeof document !== "undefined" &&
				createPortal(
					<AnimatePresence>
						{open && triggerRect && (
							<ProjectPopupMenu
								key={project.id}
								project={project}
								currentPath={currentPath}
								triggerRect={triggerRect}
								onMouseEnter={cancelClose}
								onMouseLeave={scheduleClose}
							/>
						)}
					</AnimatePresence>,
					document.body,
				)}
		</div>
	);
}

function ProjectPopupMenu({
	project,
	currentPath,
	triggerRect,
	onMouseEnter,
	onMouseLeave,
}: {
	project: Project;
	currentPath: string;
	triggerRect: DOMRect;
	onMouseEnter: () => void;
	onMouseLeave: () => void;
}) {
	const popupRef = useRef<HTMLDivElement>(null);
	// Initial guess: vertically center on the trigger row. Refined after
	// mount once we know the popup's actual height.
	const [position, setPosition] = useState<{ top: number; left: number }>(
		() => ({
			top: triggerRect.top,
			left: triggerRect.right + POPUP_GAP_PX,
		}),
	);

	useLayoutEffect(() => {
		const el = popupRef.current;
		if (!el) return;
		const popupHeight = el.offsetHeight;
		const viewportHeight = window.innerHeight;
		const triggerCenter = triggerRect.top + triggerRect.height / 2;

		// Default: vertically center the popup on the trigger row.
		let top = triggerCenter - popupHeight / 2;

		// Clamp to viewport. If the popup is taller than the room below the
		// trigger, the bottom-clamp branch effectively raises it so it ends
		// at the bottom edge — i.e. above the trigger when the trigger is
		// near the bottom of the screen.
		const maxTop = viewportHeight - popupHeight - VIEWPORT_MARGIN_PX;
		const minTop = VIEWPORT_MARGIN_PX;
		if (top > maxTop) top = maxTop;
		if (top < minTop) top = minTop;

		setPosition({ top, left: triggerRect.right + POPUP_GAP_PX });
	}, [triggerRect]);

	return (
		<motion.div
			ref={popupRef}
			role="menu"
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
			style={{ top: position.top, left: position.left }}
			initial={{ opacity: 0, x: -6, scale: 0.97 }}
			animate={{ opacity: 1, x: 0, scale: 1 }}
			exit={{ opacity: 0, x: -6, scale: 0.97 }}
			transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
			className="fixed z-50 w-56 origin-left rounded-xl border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5"
		>
			<div className="border-b border-slate-100 px-3 py-2">
				<p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
					Project
				</p>
				<p className="truncate text-sm font-semibold text-slate-900">
					{project.title || "Untitled project"}
				</p>
			</div>
			<ul className="py-1">
				{SUB_ITEMS.map((item) => {
					const active = item.matches(currentPath, project.id);
					return (
						<li key={item.label}>
							<Link
								to={item.to}
								params={{ projectId: project.id }}
								className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
									active
										? "bg-slate-900 text-white"
										: "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
								}`}
							>
								<item.icon
									className={`h-4 w-4 shrink-0 ${
										active ? "text-white" : "text-slate-400"
									}`}
								/>
								<span className="truncate">{item.label}</span>
							</Link>
						</li>
					);
				})}
			</ul>
		</motion.div>
	);
}
