import { Loader2, Play, Square, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AiRunState } from "@/stores/aiRunStore";
import { toElapsedSeconds } from "./AiActivityTimeline";

// =============================================================================
// Run banner between the thread and the composer: what phase the run is in,
// how long it has been working, and the Stop / Resume controls. Rendered by
// the panel whenever `run.isSending || run.resumable`.
// =============================================================================

export interface AiRunBannerProps {
	run: AiRunState;
	onCancel: () => void;
	onResume: () => void;
}

/** Phase copy; the execute phase counts roadmaps from `commitsProgress`. */
export const getRunBannerLabel = (
	run: Pick<AiRunState, "phase" | "commitsProgress" | "resumable">,
): string => {
	if (run.resumable) {
		return "Lost contact while Proyekto was working. The run may still be in progress.";
	}
	switch (run.phase) {
		case "propose":
			return "Drafting a proposal...";
		case "execute": {
			const progress = run.commitsProgress;
			if (progress && progress.total > 0) {
				const noun = progress.total === 1 ? "roadmap" : "roadmaps";
				return `Applying changes (${progress.done}/${progress.total} ${noun})...`;
			}
			return "Applying changes...";
		}
		case "verify":
			return "Verifying...";
		default:
			return "Investigating...";
	}
};

export const shouldRenderRunBanner = (
	run: Pick<AiRunState, "isSending" | "resumable">,
): boolean => run.isSending || Boolean(run.resumable);

export function AiRunBanner({ run, onCancel, onResume }: AiRunBannerProps) {
	const [now, setNow] = useState(() => Date.now());
	const isResumable = Boolean(run.resumable);

	useEffect(() => {
		if (!run.isSending) return;
		const handle = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(handle);
	}, [run.isSending]);

	const seconds = useMemo(() => {
		if (!run.liveActivity) return 0;
		return toElapsedSeconds(run.liveActivity, now);
	}, [run.liveActivity, now]);

	if (!shouldRenderRunBanner(run)) return null;

	return (
		<div
			className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] text-card-foreground"
			role="status"
			aria-live="polite"
			data-testid="ai-run-banner"
		>
			{isResumable ? (
				<TriangleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
			) : (
				<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
			)}
			<span className="min-w-0 flex-1 truncate">{getRunBannerLabel(run)}</span>
			{!isResumable && seconds > 0 && (
				<span className="shrink-0 tabular-nums text-muted-foreground">
					{seconds}s
				</span>
			)}
			{isResumable && (
				<button
					type="button"
					onClick={onResume}
					className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground hover:opacity-90"
				>
					<Play className="h-3 w-3" />
					Resume
				</button>
			)}
			<button
				type="button"
				onClick={onCancel}
				disabled={run.cancelRequested && !isResumable}
				className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
			>
				<Square className="h-3 w-3" />
				{run.cancelRequested && !isResumable ? "Stopping" : "Stop"}
			</button>
		</div>
	);
}

export default AiRunBanner;
