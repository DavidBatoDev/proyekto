import { CheckCircle2, type LucideIcon, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";

/**
 * Shared chrome for the roadmap's inline confirm prompts.
 *
 * These can't use `AppConfirmDialog`: each carries custom body content (a date
 * diff, a reorder preview, a "don't ask again" opt-out) and is driven by
 * transient drag state rather than a promise. This keeps the shell — overlay,
 * enter/exit transition, header, footer — in one place so the five callers
 * stay identical, and on theme tokens rather than the legacy orange palette.
 */
export interface RoadmapConfirmShellProps {
	isOpen: boolean;
	icon: LucideIcon;
	title: string;
	subtitle?: string;
	/** Accessible name for the close button, e.g. "Close date update modal". */
	closeLabel: string;
	isSaving?: boolean;
	confirmLabel?: string;
	savingLabel?: string;
	onCancel: () => void;
	onConfirm: () => Promise<void> | void;
	children: ReactNode;
}

export const RoadmapConfirmShell = ({
	isOpen,
	icon: Icon,
	title,
	subtitle,
	closeLabel,
	isSaving = false,
	confirmLabel = "Confirm",
	savingLabel = "Saving...",
	onCancel,
	onConfirm,
	children,
}: RoadmapConfirmShellProps) => {
	const [shouldRender, setShouldRender] = useState(isOpen);
	const [isVisible, setIsVisible] = useState(isOpen);

	useEffect(() => {
		if (isOpen) {
			setShouldRender(true);
			const raf = requestAnimationFrame(() => setIsVisible(true));
			return () => cancelAnimationFrame(raf);
		}
		setIsVisible(false);
		const timeout = window.setTimeout(() => setShouldRender(false), 200);
		return () => window.clearTimeout(timeout);
	}, [isOpen]);

	if (!shouldRender) return null;

	return (
		<ModalPortal>
			<div
				className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[3px] transition-opacity duration-200 ${
					isVisible ? "opacity-100" : "opacity-0"
				}`}
			>
				<div
					className={`w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-[0_24px_80px_rgba(15,23,42,0.35)] transition-all duration-200 ${
						isVisible
							? "translate-y-0 scale-100 opacity-100"
							: "translate-y-2 scale-95 opacity-0"
					}`}
				>
					<div className="flex items-center justify-between border-b border-border bg-muted/50 px-5 py-4">
						<div className="flex items-center gap-3">
							<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
								<Icon size={18} />
							</div>
							<div>
								<h3 className="text-base font-semibold text-foreground">
									{title}
								</h3>
								{subtitle && (
									<p className="text-xs text-muted-foreground">{subtitle}</p>
								)}
							</div>
						</div>
						<button
							type="button"
							onClick={onCancel}
							className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							aria-label={closeLabel}
						>
							<X size={16} />
						</button>
					</div>

					<div className="space-y-4 px-5 py-5 text-sm text-foreground">
						{children}
					</div>

					<div className="flex justify-end gap-2 border-t border-border bg-muted/30 px-5 py-4">
						<button
							type="button"
							onClick={onCancel}
							disabled={isSaving}
							className="rounded-lg border border-input bg-card px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={() => void onConfirm()}
							disabled={isSaving}
							className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
						>
							<CheckCircle2 size={15} />
							{isSaving ? savingLabel : confirmLabel}
						</button>
					</div>
				</div>
			</div>
		</ModalPortal>
	);
};

/** The shared "don't ask again" opt-out these prompts all offer. */
export const DontAskAgainToggle = ({
	id,
	checked,
	onChange,
}: {
	id: string;
	checked: boolean;
	onChange: (value: boolean) => void;
}) => (
	<label
		htmlFor={id}
		className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground"
	>
		<input
			id={id}
			type="checkbox"
			checked={checked}
			onChange={(event) => onChange(event.target.checked)}
			className="h-4 w-4 rounded border-input accent-primary"
		/>
		<span>Don&apos;t ask again in this session</span>
	</label>
);
