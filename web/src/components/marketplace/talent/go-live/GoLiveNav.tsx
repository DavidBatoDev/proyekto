import { CheckCircle2, Loader2 } from "lucide-react";

/**
 * The wizard's fixed bottom bar: progress, Back, and the primary action.
 *
 * It carries the progress indicator now that the labelled step rail is gone —
 * one thin fill along the top edge, which reads at a glance and costs no
 * vertical space, where six labelled circles cost a whole band of it.
 *
 * Fixed is safe here because the marketplace footer was removed from this page.
 * An earlier version had to sit in flow precisely because that footer existed
 * and a fixed bar would have covered it permanently; the page now reserves
 * bottom padding for this instead.
 */
export function GoLiveNav({
	currentStep,
	totalSteps,
	isSaving,
	onBack,
	onNext,
}: {
	currentStep: number;
	totalSteps: number;
	isSaving: boolean;
	onBack: () => void;
	onNext: () => void;
}) {
	const isFinalStep = currentStep === totalSteps;
	const progress = Math.round((currentStep / totalSteps) * 100);

	return (
		<div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
			{/* Progress sits on the border itself, so the bar keeps its full height. */}
			<div
				className="absolute inset-x-0 top-0 h-[3px] bg-muted"
				role="progressbar"
				aria-valuenow={currentStep}
				aria-valuemin={1}
				aria-valuemax={totalSteps}
				aria-label={`Step ${currentStep} of ${totalSteps}`}
			>
				<div
					className="h-full bg-primary transition-[width] duration-500 ease-out"
					style={{ width: `${progress}%` }}
				/>
			</div>

			<div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6 lg:px-8">
				<div className="flex items-center gap-4">
					<button
						type="button"
						onClick={onBack}
						disabled={currentStep === 1 || isSaving}
						className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
					>
						Back
					</button>
					<span className="hidden text-xs text-muted-foreground sm:block">
						Step {currentStep} of {totalSteps}
					</span>
				</div>

				<button
					type="button"
					onClick={onNext}
					disabled={isSaving}
					className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 sm:px-8"
				>
					{isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
					{isFinalStep ? (
						<>
							{!isSaving && <CheckCircle2 className="h-4 w-4" />}
							{isSaving ? "Publishing…" : "Go live"}
						</>
					) : (
						"Continue"
					)}
				</button>
			</div>
		</div>
	);
}
