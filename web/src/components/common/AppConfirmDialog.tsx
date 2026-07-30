import { Loader2 } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { AppDialog } from "@/components/common/AppDialog";

/**
 * The styled replacement for `window.confirm`.
 *
 * Most callers should reach for `useConfirm()` instead — it returns a promise,
 * so a native `if (!confirm(...)) return;` becomes a one-line swap. Use this
 * component directly only when the confirm needs custom body content.
 */

export type ConfirmTone = "default" | "danger";

export interface AppConfirmDialogProps {
	open: boolean;
	title: string;
	message?: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	tone?: ConfirmTone;
	busy?: boolean;
	onConfirm: () => void;
	onClose: () => void;
}

export function AppConfirmDialog({
	open,
	title,
	message,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	tone = "default",
	busy = false,
	onConfirm,
	onClose,
}: AppConfirmDialogProps) {
	const cancelRef = useRef<HTMLButtonElement | null>(null);
	const confirmRef = useRef<HTMLButtonElement | null>(null);
	// Focus Cancel on destructive prompts so a stray Enter doesn't delete
	// anything; focus Confirm otherwise, where it is the expected next step.
	const initialFocusRef = tone === "danger" ? cancelRef : confirmRef;

	return (
		<AppDialog
			open={open}
			onClose={onClose}
			title={title}
			size="sm"
			busy={busy}
			hideCloseButton
			initialFocusRef={initialFocusRef}
			footer={
				<>
					<button
						type="button"
						ref={cancelRef}
						onClick={onClose}
						disabled={busy}
						className="rounded-xl border border-input px-4 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						ref={confirmRef}
						onClick={onConfirm}
						disabled={busy}
						className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
							tone === "danger"
								? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
								: "bg-primary text-primary-foreground hover:bg-primary/90"
						}`}
					>
						{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
						{confirmLabel}
					</button>
				</>
			}
		>
			{typeof message === "string" ? (
				<p className="text-sm leading-relaxed text-muted-foreground">
					{message}
				</p>
			) : (
				message
			)}
		</AppDialog>
	);
}
