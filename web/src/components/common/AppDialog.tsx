import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useId,
	useRef,
} from "react";
import { ModalPortal } from "@/components/common/ModalPortal";

/**
 * The repo's dialog primitive.
 *
 * Before this existed every modal hand-rolled its own overlay and none of them
 * handled Escape, focus, or background scroll — which is a large part of why
 * destructive actions on the Team and Contract surfaces fell back to
 * `window.confirm`. `ModalPortal` only escapes the `backdrop-filter` trap; it
 * deliberately does nothing else. This adds the behaviour on top.
 *
 * Z-index ladder, so nothing has to guess:
 *   AppDialog        1200  (nested dialogs step up by 10)
 *   time modals       170
 *   roadmap SidePanel 10000 — deliberately above dialogs; it is a workspace,
 *                             not an overlay, and hosts its own create flows.
 */

export type AppDialogSize = "sm" | "md" | "lg" | "xl";
export type AppDialogVariant = "center" | "drawer-right" | "bottom-sheet";

const SIZE_CLASS: Record<AppDialogSize, string> = {
	sm: "max-w-sm",
	md: "max-w-md",
	lg: "max-w-2xl",
	xl: "max-w-4xl",
};

const DRAWER_SIZE_CLASS: Record<AppDialogSize, string> = {
	sm: "max-w-sm",
	md: "max-w-md",
	lg: "max-w-lg",
	xl: "max-w-2xl",
};

const FOCUSABLE =
	'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Ref-counted so nested dialogs don't fight over `body.overflow`. A plain
 * set-on-open / clear-on-close pair unlocks scrolling the moment the inner
 * dialog closes, while the outer one is still up.
 */
let scrollLockCount = 0;
function lockBodyScroll(): () => void {
	if (typeof document === "undefined") return () => {};
	if (scrollLockCount === 0) {
		document.body.dataset.appDialogPrevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
	}
	scrollLockCount += 1;
	return () => {
		scrollLockCount = Math.max(0, scrollLockCount - 1);
		if (scrollLockCount === 0) {
			document.body.style.overflow =
				document.body.dataset.appDialogPrevOverflow ?? "";
			delete document.body.dataset.appDialogPrevOverflow;
		}
	};
}

export interface AppDialogProps {
	open: boolean;
	onClose: () => void;
	title?: ReactNode;
	description?: ReactNode;
	size?: AppDialogSize;
	variant?: AppDialogVariant;
	footer?: ReactNode;
	/** Blocks Escape and backdrop-close while a mutation is in flight. */
	busy?: boolean;
	zIndex?: number;
	initialFocusRef?: RefObject<HTMLElement | null>;
	hideCloseButton?: boolean;
	className?: string;
	children: ReactNode;
}

export function AppDialog({
	open,
	onClose,
	title,
	description,
	size = "md",
	variant = "center",
	footer,
	busy = false,
	zIndex = 1200,
	initialFocusRef,
	hideCloseButton = false,
	className,
	children,
}: AppDialogProps) {
	const panelRef = useRef<HTMLDivElement | null>(null);
	const titleId = useId();
	const descId = useId();

	// Escape to close, unless a mutation is mid-flight.
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !busy) {
				e.stopPropagation();
				onClose();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, busy, onClose]);

	useEffect(() => {
		if (!open) return;
		return lockBodyScroll();
	}, [open]);

	// Move focus in on open and put it back where it came from on close —
	// otherwise keyboard users land at the top of the document.
	useEffect(() => {
		if (!open) return;
		const previous = document.activeElement as HTMLElement | null;
		const frame = requestAnimationFrame(() => {
			const target =
				initialFocusRef?.current ??
				panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
				panelRef.current;
			target?.focus();
		});
		return () => {
			cancelAnimationFrame(frame);
			previous?.focus?.();
		};
	}, [open, initialFocusRef]);

	// Trap Tab inside the panel.
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Tab" || !panelRef.current) return;
			const nodes = Array.from(
				panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
			).filter(
				(el) => el.offsetParent !== null || el === document.activeElement,
			);
			if (nodes.length === 0) {
				e.preventDefault();
				return;
			}
			const first = nodes[0];
			const last = nodes[nodes.length - 1];
			const active = document.activeElement as HTMLElement | null;
			if (
				e.shiftKey &&
				(active === first || !panelRef.current.contains(active))
			) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && active === last) {
				e.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open]);

	if (!open) return null;

	const isDrawer = variant === "drawer-right";
	const isSheet = variant === "bottom-sheet";
	// The sheet clears the home indicator with .pb-app-sheet and is capped short
	// of the viewport so the backdrop above it stays a visible tap-to-dismiss
	// target — a sheet flush with the top edge reads as a full page.
	const panelClass = isDrawer
		? `flex h-full w-full flex-col border-l border-border bg-card shadow-2xl ${DRAWER_SIZE_CLASS[size]}`
		: isSheet
			? "flex max-h-[85vh] w-full flex-col rounded-t-2xl border-t border-border bg-card pb-app-sheet shadow-2xl"
			: `flex max-h-[90vh] w-full flex-col rounded-2xl border border-border bg-card shadow-xl ${SIZE_CLASS[size]}`;

	return (
		<ModalPortal>
			<AnimatePresence>
				<motion.div
					key="backdrop"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.15 }}
					style={{ zIndex }}
					className={`fixed inset-0 flex bg-black/50 ${
						isDrawer
							? "justify-end"
							: isSheet
								? "items-end justify-center"
								: "items-center justify-center p-4"
					}`}
					onClick={() => {
						if (!busy) onClose();
					}}
				>
					<motion.div
						key="panel"
						ref={panelRef}
						role="dialog"
						aria-modal="true"
						aria-labelledby={title ? titleId : undefined}
						aria-describedby={description ? descId : undefined}
						tabIndex={-1}
						initial={
							isDrawer
								? { x: 24, opacity: 0 }
								: isSheet
									? { y: "100%" }
									: { scale: 0.97, opacity: 0 }
						}
						animate={
							isDrawer
								? { x: 0, opacity: 1 }
								: isSheet
									? { y: 0 }
									: { scale: 1, opacity: 1 }
						}
						exit={
							isDrawer
								? { x: 24, opacity: 0 }
								: isSheet
									? { y: "100%" }
									: { scale: 0.97, opacity: 0 }
						}
						transition={
							isSheet ? { duration: 0.25, ease: "easeOut" } : { duration: 0.15 }
						}
						className={`${panelClass} ${className ?? ""} outline-none`}
						onClick={(e) => e.stopPropagation()}
					>
						{isSheet && (
							<span
								aria-hidden="true"
								className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border"
							/>
						)}
						{(title || !hideCloseButton) && (
							<div className="flex items-start gap-3 border-b border-border px-5 py-4">
								<div className="min-w-0 flex-1">
									{title && (
										<h2
											id={titleId}
											className="text-sm font-bold text-card-foreground"
										>
											{title}
										</h2>
									)}
									{description && (
										<p
											id={descId}
											className="mt-1 text-xs leading-relaxed text-muted-foreground"
										>
											{description}
										</p>
									)}
								</div>
								{!hideCloseButton && (
									<button
										type="button"
										onClick={onClose}
										disabled={busy}
										aria-label="Close"
										className="-mr-1 shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
									>
										<X className="h-4 w-4" />
									</button>
								)}
							</div>
						)}

						<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
							{children}
						</div>

						{footer && (
							<div className="flex justify-end gap-2 border-t border-border px-5 py-3">
								{footer}
							</div>
						)}
					</motion.div>
				</motion.div>
			</AnimatePresence>
		</ModalPortal>
	);
}
