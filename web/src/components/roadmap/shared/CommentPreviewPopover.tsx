import { formatDistanceToNow } from "date-fns";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CommentPreview } from "@/types/roadmap";

const POPOVER_WIDTH = 260;
/** Long enough not to fire while the pointer crosses the badge on its way past. */
const OPEN_DELAY_MS = 250;

interface CommentPreviewPopoverProps {
	preview: CommentPreview | null;
	commentCount: number;
	/** What the preview is about, e.g. a task title. Rendered as the header. */
	contextTitle?: string;
	/** The badge itself. Hover/focus handlers are attached to the wrapper. */
	children: ReactNode;
	className?: string;
}

/**
 * Hover preview for a canvas comment badge.
 *
 * PORTALLED, not positioned in place, and that is load-bearing: the task
 * comment gutter is `pointer-events-none … overflow-hidden` with a translateY
 * transform, and the feature card's content wrapper is `overflow-hidden` inside
 * a max-height card — an inline popover is clipped by both. Coordinates come
 * from getBoundingClientRect and are refreshed on scroll/resize, mirroring the
 * status menu in FeatureWidget.
 */
export const CommentPreviewPopover = ({
	preview,
	commentCount,
	contextTitle,
	children,
	className,
}: CommentPreviewPopoverProps) => {
	const anchorRef = useRef<HTMLDivElement | null>(null);
	const openTimerRef = useRef<number | undefined>(undefined);
	const [isOpen, setIsOpen] = useState(false);
	const [position, setPosition] = useState({ top: 0, left: 0 });

	const updatePosition = () => {
		const rect = anchorRef.current?.getBoundingClientRect();
		if (!rect) return;
		setPosition({
			top: rect.bottom + 6,
			left: Math.max(
				8,
				Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8),
			),
		});
	};

	useEffect(() => {
		if (!isOpen) return;
		updatePosition();
		const handleReposition = () => updatePosition();
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setIsOpen(false);
		};
		window.addEventListener("scroll", handleReposition, true);
		window.addEventListener("resize", handleReposition);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("scroll", handleReposition, true);
			window.removeEventListener("resize", handleReposition);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [isOpen]);

	useEffect(
		() => () => {
			if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
		},
		[],
	);

	const open = () => {
		if (!preview) return;
		if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
		openTimerRef.current = window.setTimeout(
			() => setIsOpen(true),
			OPEN_DELAY_MS,
		);
	};
	const close = () => {
		if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
		setIsOpen(false);
	};

	return (
		<div
			ref={anchorRef}
			className={className}
			onMouseEnter={open}
			onMouseLeave={close}
			onFocus={open}
			onBlur={close}
		>
			{children}
			{isOpen &&
				preview &&
				createPortal(
					<div
						role="tooltip"
						className="pointer-events-none fixed z-300 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
						style={{
							top: position.top,
							left: position.left,
							width: POPOVER_WIDTH,
						}}
					>
						{contextTitle && (
							<p className="mb-1 truncate text-[11px] font-semibold text-muted-foreground">
								{contextTitle}
							</p>
						)}
						<p className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
							<span className="truncate font-medium text-foreground">
								{preview.author_name ?? "Someone"}
							</span>
							<span aria-hidden="true">·</span>
							<span className="shrink-0">
								{formatRelative(preview.created_at)}
							</span>
						</p>
						{/*
						 * Rendered as TEXT, never as HTML. The server already stripped
						 * the comment's markup; treating it as text here means a crafted
						 * comment cannot become markup on the canvas even if that ever
						 * regressed.
						 */}
						<p className="line-clamp-3 text-xs leading-snug text-foreground">
							{preview.excerpt}
						</p>
						{commentCount > 1 && (
							<p className="mt-1.5 text-[11px] text-muted-foreground">
								{commentCount} comments · click to open
							</p>
						)}
					</div>,
					document.body,
				)}
		</div>
	);
};

/** Never let an unparseable timestamp take the whole card down. */
function formatRelative(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return formatDistanceToNow(date, { addSuffix: true });
}
