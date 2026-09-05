import { AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { AiThreadList } from "./AiThreadList";
import type { AiSessionScope } from "./scope";

// =============================================================================
// Thread picker trigger + the portaled `AiThreadList` popover. The trigger's
// look is overridable so the dashboard can put it on sidebar tokens while the
// roadmap panel keeps the plain border.
// =============================================================================

export interface AiThreadMenuButtonProps {
	scope: AiSessionScope | null;
	activeThreadId: string | null;
	/** Trigger text: the active thread's title, "New thread" when there is none. */
	label: string;
	onSelectThread: (threadId: string) => void;
	onCreateNewThread: () => void | Promise<void>;
	/** A thread was hard-deleted from the picker. */
	onDeleted?: (threadId: string) => void;
	disabled?: boolean;
	className?: string;
}

const DEFAULT_TRIGGER_CLASS =
	"flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60";

export function AiThreadMenuButton({
	scope,
	activeThreadId,
	label,
	onSelectThread,
	onCreateNewThread,
	onDeleted,
	disabled,
	className,
}: AiThreadMenuButtonProps) {
	const [isOpen, setIsOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);

	return (
		<div className="relative">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setIsOpen((prev) => !prev)}
				disabled={disabled || !scope}
				className={className ?? DEFAULT_TRIGGER_CLASS}
				aria-haspopup="dialog"
				aria-expanded={isOpen}
			>
				<span className="max-w-[140px] truncate">{label}</span>
				<ChevronDown size={12} />
			</button>
			<AnimatePresence>
				{isOpen && scope && (
					<AiThreadList
						scope={scope}
						activeThreadId={activeThreadId}
						anchorRef={triggerRef}
						onSelectThread={(threadId) => {
							onSelectThread(threadId);
							setIsOpen(false);
						}}
						onCreateNewThread={onCreateNewThread}
						onDeleted={onDeleted}
						onClose={() => setIsOpen(false)}
					/>
				)}
			</AnimatePresence>
		</div>
	);
}

export default AiThreadMenuButton;
