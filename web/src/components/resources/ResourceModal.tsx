import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";

/**
 * The modal chrome the resource dialogs share.
 *
 * Portalled to `document.body` because the surfaces that host it sit inside
 * `backdrop-filter` containers, which would otherwise become the containing
 * block for `position: fixed` and trap the overlay inside the card.
 */
export function ResourceModal({
	title,
	onClose,
	children,
	headerExtra,
	maxWidthClass = "max-w-lg",
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
	headerExtra?: ReactNode;
	maxWidthClass?: string;
}) {
	return (
		<ModalPortal>
			<div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm">
				<div
					className={`w-full ${maxWidthClass} overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_48px_rgba(15,23,42,0.2)]`}
				>
					<div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
						<h3 className="min-w-0 truncate text-base font-semibold text-foreground">
							{title}
						</h3>
						{headerExtra}
						<button
							type="button"
							onClick={onClose}
							aria-label="Close"
							className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted"
						>
							<ChevronDown className="h-4 w-4 rotate-90" />
						</button>
					</div>
					<div className="p-4">{children}</div>
				</div>
			</div>
		</ModalPortal>
	);
}
