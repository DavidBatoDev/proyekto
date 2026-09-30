import { Copy, Flag, Pencil, Reply, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { QUICK_REACTIONS } from "./reactions";

export interface MessageSheetActions {
	onReact?: (emoji: string) => void;
	onReply?: () => void;
	onCopy?: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
	onReport?: () => void;
}

/**
 * The touch version of a message's hover menu, opened by a long-press: the
 * message, a row of quick reactions, then large tap targets. Destructive and
 * safety actions sit apart at the bottom, in red.
 */
export function MessageActionSheet({
	open,
	onClose,
	senderName,
	preview,
	actions,
}: {
	open: boolean;
	onClose: () => void;
	senderName: string;
	preview: string;
	actions: MessageSheetActions;
}) {
	const run = (fn?: () => void) => () => {
		onClose();
		fn?.();
	};
	const { onReact, onReply, onCopy, onEdit, onDelete, onReport } = actions;
	const hasDanger = Boolean(onDelete || onReport);

	return (
		<AppDialog
			open={open}
			onClose={onClose}
			variant="bottom-sheet"
			hideCloseButton
			bare
			zIndex={1250}
		>
			<div className="min-h-0 overflow-y-auto px-4 pb-3 pt-3">
				<div className="rounded-2xl bg-muted/50 px-4 py-3">
					<p className="text-xs font-semibold text-muted-foreground">
						{senderName}
					</p>
					<p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm text-foreground">
						{preview.trim() || (
							<span className="italic text-muted-foreground">Attachment</span>
						)}
					</p>
				</div>

				{onReact && (
					<div className="mt-3 flex items-center justify-between rounded-2xl border border-border bg-card px-2 py-1.5">
						{QUICK_REACTIONS.map((emoji) => (
							<button
								key={emoji}
								type="button"
								onClick={run(() => onReact(emoji))}
								aria-label={`React with ${emoji}`}
								className="flex h-11 w-11 items-center justify-center rounded-full text-2xl transition-transform active:scale-90 active:bg-muted"
							>
								{emoji}
							</button>
						))}
					</div>
				)}

				<div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
					{onReply && (
						<SheetRow icon={<Reply />} label="Reply" onClick={run(onReply)} />
					)}
					{onCopy && (
						<SheetRow icon={<Copy />} label="Copy text" onClick={run(onCopy)} />
					)}
					{onEdit && (
						<SheetRow icon={<Pencil />} label="Edit" onClick={run(onEdit)} />
					)}
				</div>

				{hasDanger && (
					<div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
						{onDelete && (
							<SheetRow
								icon={<Trash2 />}
								label="Delete message"
								tone="danger"
								onClick={run(onDelete)}
							/>
						)}
						{onReport && (
							<SheetRow
								icon={<Flag />}
								label="Report message"
								tone="danger"
								onClick={run(onReport)}
							/>
						)}
					</div>
				)}
			</div>
		</AppDialog>
	);
}

function SheetRow({
	icon,
	label,
	onClick,
	tone = "default",
}: {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	tone?: "default" | "danger";
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex h-12 w-full items-center gap-3 border-b border-border px-4 text-left text-[15px] font-medium transition-colors last:border-b-0 active:bg-muted [&_svg]:h-5 [&_svg]:w-5 ${
				tone === "danger" ? "text-destructive" : "text-foreground"
			}`}
		>
			<span className={tone === "danger" ? "" : "text-muted-foreground"}>
				{icon}
			</span>
			{label}
		</button>
	);
}
