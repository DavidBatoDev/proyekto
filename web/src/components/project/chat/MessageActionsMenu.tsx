import { Copy, MoreHorizontal, Pencil, Reply, Trash2 } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

const MENU_WIDTH = 160; // matches w-40
const ITEM_HEIGHT = 33; // approx per row, for the flip-up calc
const VIEWPORT_PAD = 8;

/**
 * Hover "⋯" kebab on a message bubble. Opens a small dropdown of per-message
 * actions (Reply / Copy / Edit / Delete). Edit + Delete are gated on `canModify`
 * (own, non-deleted messages); Copy needs text.
 *
 * The dropdown is rendered through a portal with fixed positioning so it never
 * contributes to the message list's scroll overflow — an absolutely-positioned
 * child would make MessageList (which is `overflow-x-hidden`, forcing
 * `overflow-y: auto`) sprout a spurious scrollbar. Closes on outside-click, Esc,
 * scroll, or resize.
 */
export function MessageActionsMenu({
	isMine,
	canModify,
	hasText,
	onReply,
	onCopy,
	onEdit,
	onDelete,
}: {
	isMine: boolean;
	canModify: boolean;
	hasText: boolean;
	onReply?: () => void;
	onCopy?: () => void;
	onEdit?: () => void;
	/** `bypassConfirm` is true on Shift-click (skip the confirm modal). */
	onDelete?: (bypassConfirm: boolean) => void;
}) {
	const [open, setOpen] = useState(false);
	const [coords, setCoords] = useState<{ top: number; left: number } | null>(
		null,
	);
	const btnRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);

	const showReply = !!onReply;
	const showCopy = hasText && !!onCopy;
	const showEdit = canModify && !!onEdit;
	const showDelete = canModify && !!onDelete;
	const itemCount =
		Number(showReply) + Number(showCopy) + Number(showEdit) + Number(showDelete);

	const place = useCallback(() => {
		const rect = btnRef.current?.getBoundingClientRect();
		if (!rect) return;
		const gap = 4;
		const estHeight = itemCount * ITEM_HEIGHT + 8;
		// Horizontally anchor the menu near the button, clamped to the viewport.
		let left = isMine ? rect.right - MENU_WIDTH : rect.left;
		left = Math.max(
			VIEWPORT_PAD,
			Math.min(left, window.innerWidth - MENU_WIDTH - VIEWPORT_PAD),
		);
		// Open downward, flipping up if it would overflow the viewport bottom.
		let top = rect.bottom + gap;
		if (top + estHeight > window.innerHeight - VIEWPORT_PAD) {
			top = Math.max(VIEWPORT_PAD, rect.top - estHeight - gap);
		}
		setCoords({ top, left });
	}, [isMine, itemCount]);

	useLayoutEffect(() => {
		if (!open) return;
		place();
		// A fixed-positioned menu would detach from its button on scroll/resize, so
		// just close it instead of tracking. `true` catches scrolls on any ancestor.
		const close = () => setOpen(false);
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (
				target &&
				(btnRef.current?.contains(target) || menuRef.current?.contains(target))
			)
				return;
			setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		window.addEventListener("scroll", close, true);
		window.addEventListener("resize", close);
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("scroll", close, true);
			window.removeEventListener("resize", close);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open, place]);

	const run = (fn?: () => void) => {
		setOpen(false);
		fn?.();
	};

	return (
		<div className={`absolute -top-1 z-20 ${isMine ? "-left-7" : "-right-7"}`}>
			<button
				ref={btnRef}
				type="button"
				onClick={() => setOpen((value) => !value)}
				className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-opacity hover:bg-slate-100 hover:text-slate-700 ${
					open ? "opacity-100" : "opacity-0 group-hover/line:opacity-100"
				}`}
				aria-label="Message actions"
				aria-haspopup="menu"
				aria-expanded={open}
			>
				<MoreHorizontal className="h-4 w-4" />
			</button>

			{open &&
				coords &&
				createPortal(
					<div
						ref={menuRef}
						role="menu"
						style={{ position: "fixed", top: coords.top, left: coords.left }}
						className="z-50 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
					>
						{showReply && (
							<MenuItem
								icon={<Reply className="h-4 w-4" />}
								label="Reply"
								onClick={() => run(onReply)}
							/>
						)}
						{showCopy && (
							<MenuItem
								icon={<Copy className="h-4 w-4" />}
								label="Copy text"
								onClick={() => run(onCopy)}
							/>
						)}
						{showEdit && (
							<MenuItem
								icon={<Pencil className="h-4 w-4" />}
								label="Edit"
								onClick={() => run(onEdit)}
							/>
						)}
						{showDelete && (
							<button
								type="button"
								role="menuitem"
								onClick={(event) => {
									const bypass = event.shiftKey;
									setOpen(false);
									onDelete?.(bypass);
								}}
								className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
							>
								<span className="text-red-500">
									<Trash2 className="h-4 w-4" />
								</span>
								Delete
							</button>
						)}
					</div>,
					document.body,
				)}
		</div>
	);
}

function MenuItem({
	icon,
	label,
	onClick,
}: {
	icon: ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			onClick={onClick}
			className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
		>
			<span className="text-slate-400">{icon}</span>
			{label}
		</button>
	);
}
