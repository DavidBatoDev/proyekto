import { Loader2, MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuTone = "default" | "success" | "warning" | "danger" | "info";

export interface ActionMenuItem {
	id: string;
	label: string;
	icon: ReactNode;
	onSelect: () => void;
	disabled?: boolean;
	tone?: MenuTone;
}

/**
 * Portal-positioned "⋯" actions menu. Opens upward when there isn't room
 * below, closes on outside click / Escape / scroll. Extracted from
 * TeamApprovalsGrid so the grid and the inbox share one implementation.
 */
export function RowActionsMenu({
	rowId,
	openMenuRowId,
	onSetOpenMenuRowId,
	items,
	disabled,
	loading,
	menuZIndexClassName = "z-70",
}: {
	rowId: string;
	openMenuRowId: string | null;
	onSetOpenMenuRowId: (rowId: string | null) => void;
	items: ActionMenuItem[];
	disabled?: boolean;
	loading?: boolean;
	/** Override when the menu is portalled above a higher-stacked modal (default sits below modals like PayMemberModal at z-165). */
	menuZIndexClassName?: string;
}) {
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const isOpen = openMenuRowId === rowId;
	const [menuPosition, setMenuPosition] = useState({
		top: 0,
		left: 0,
		openUpward: false,
	});

	useEffect(() => {
		if (!isOpen) return;
		const updatePosition = () => {
			if (!triggerRef.current) return;
			const rect = triggerRef.current.getBoundingClientRect();
			const estimatedMenuHeight = Math.max(140, items.length * 34 + 10);
			const openUpward =
				rect.bottom + estimatedMenuHeight > window.innerHeight - 8;
			setMenuPosition({
				top: openUpward ? rect.top - 6 : rect.bottom + 6,
				left: rect.right,
				openUpward,
			});
		};
		const handlePointer = (event: MouseEvent) => {
			const target = event.target as Node;
			const inTrigger = triggerRef.current?.contains(target);
			const inMenu = menuRef.current?.contains(target);
			if (!inTrigger && !inMenu) onSetOpenMenuRowId(null);
		};
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onSetOpenMenuRowId(null);
		};
		updatePosition();
		document.addEventListener("mousedown", handlePointer);
		document.addEventListener("keydown", handleEscape);
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		return () => {
			document.removeEventListener("mousedown", handlePointer);
			document.removeEventListener("keydown", handleEscape);
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
		};
	}, [isOpen, items.length, onSetOpenMenuRowId]);

	const toneClass = (tone: MenuTone | undefined) => {
		if (tone === "success") return "text-emerald-700 hover:bg-emerald-50";
		if (tone === "info") return "text-indigo-700 hover:bg-indigo-50";
		if (tone === "warning") return "text-amber-700 hover:bg-amber-50";
		if (tone === "danger") return "text-rose-700 hover:bg-rose-50";
		return "text-slate-700 hover:bg-slate-50";
	};

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => onSetOpenMenuRowId(isOpen ? null : rowId)}
				disabled={disabled}
				title="Log actions"
				aria-label="Log actions"
				className="inline-flex items-center justify-center h-7 w-8 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{loading ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin" />
				) : (
					<MoreHorizontal className="h-3.5 w-3.5" />
				)}
			</button>
			{isOpen
				? createPortal(
						<div
							ref={menuRef}
							className={`fixed ${menuZIndexClassName} min-w-[200px] rounded-lg border border-slate-200 bg-white p-1 shadow-lg`}
							style={{
								top: menuPosition.top,
								left: menuPosition.left,
								transform: menuPosition.openUpward
									? "translate(-100%, -100%)"
									: "translateX(-100%)",
							}}
						>
							{items.map((item) => (
								<button
									key={item.id}
									type="button"
									onClick={() => {
										if (item.disabled) return;
										onSetOpenMenuRowId(null);
										item.onSelect();
									}}
									disabled={item.disabled}
									className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneClass(
										item.tone,
									)}`}
								>
									<span className="shrink-0">{item.icon}</span>
									<span>{item.label}</span>
								</button>
							))}
						</div>,
						document.body,
					)
				: null}
		</>
	);
}
