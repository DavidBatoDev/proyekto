/**
 * Asks which occurrences of a recurring thing a change applies to — this one,
 * this and following, or all — the way Google Calendar prompts.
 *
 * Generic over the scope union so each caller keeps its own typed vocabulary
 * (`MeetingEditScope`, `ContractEditScope`, …) rather than sharing one loose
 * string type. Callers supply their own title and options; see
 * `components/meetings/editor/ScopeDialog.tsx` for the meetings wrapper.
 */
import { ModalPortal } from "@/components/common/ModalPortal";

export interface ScopeOption<T extends string> {
	scope: T;
	label: string;
	/** Optional second line — use it when a scope's consequence isn't obvious. */
	description?: string;
}

interface ScopeDialogProps<T extends string> {
	open: boolean;
	title: string;
	options: readonly ScopeOption<T>[];
	onClose: () => void;
	onPick: (scope: T) => void;
	/** Shown under the options — for consequences that apply to every choice. */
	footnote?: string;
	cancelLabel?: string;
}

export function ScopeDialog<T extends string>({
	open,
	title,
	options,
	onClose,
	onPick,
	footnote,
	cancelLabel = "Cancel",
}: ScopeDialogProps<T>) {
	if (!open) return null;
	return (
		<ModalPortal>
			<div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4">
				<div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-xl">
					<div className="px-5 pb-2 pt-4">
						<h3 className="text-base font-semibold text-card-foreground">
							{title}
						</h3>
					</div>
					<div className="px-3 py-2">
						{options.map((o) => (
							<button
								key={o.scope}
								type="button"
								onClick={() => onPick(o.scope)}
								className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm text-foreground transition hover:bg-muted"
							>
								<span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-input" />
								<span>
									{o.label}
									{o.description && (
										<span className="mt-0.5 block text-xs text-muted-foreground">
											{o.description}
										</span>
									)}
								</span>
							</button>
						))}
					</div>
					{footnote && (
						<p className="px-5 pb-1 text-xs text-muted-foreground">
							{footnote}
						</p>
					)}
					<div className="flex justify-end gap-2 border-t border-border px-5 py-3">
						<button
							type="button"
							onClick={onClose}
							className="rounded-xl border border-input px-4 py-2 text-sm text-foreground transition hover:bg-muted"
						>
							{cancelLabel}
						</button>
					</div>
				</div>
			</div>
		</ModalPortal>
	);
}
