import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	CheckCircle2,
	Circle,
	Loader2,
	Rocket,
} from "lucide-react";
import { useToast } from "@/hooks/useToast";
import type {
	ActivationChecklist,
	ActivationChecklistItem,
} from "@/services/contract.service";
import { projectService } from "@/services/project.service";

/**
 * Priority ordering for the "make it live" guide: incomplete BLOCKERS first,
 * then incomplete warnings, then everything already done. It's a priority list,
 * not the raw checklist order — a consultant should see what's actually blocking
 * activation at the top, from any section.
 */
export function sortChecklistItems(
	items: ActivationChecklistItem[],
): ActivationChecklistItem[] {
	const rank = (item: ActivationChecklistItem): number => {
		if (item.ok) return 2;
		return item.severity === "blocker" ? 0 : 1;
	};
	// Stable sort preserves the backend's within-group order.
	return [...items].sort((a, b) => rank(a) - rank(b));
}

/** N completed out of total. */
export function checklistProgress(checklist: ActivationChecklist): {
	done: number;
	total: number;
} {
	return {
		done: checklist.items.filter((i) => i.ok).length,
		total: checklist.items.length,
	};
}

interface Props {
	projectId: string;
	checklist: ActivationChecklist | null;
	isLoading: boolean;
	projectStatus: string | null;
	/** `compact` for the header dropdown, `full` for Overview / Contract tab. */
	mode?: "compact" | "full";
	/** Called after a successful activation (e.g. close the header dropdown). */
	onActivated?: () => void;
}

/**
 * The shared activation guide. One implementation drives the header dropdown,
 * the Overview widget, and the Contract tab, so "how do I go live" reads the
 * same everywhere and the Activate button lives in exactly one place.
 */
export function ActivationGuide({
	projectId,
	checklist,
	isLoading,
	projectStatus,
	mode = "full",
	onActivated,
}: Props) {
	const toast = useToast();
	const qc = useQueryClient();
	const alreadyActive = projectStatus === "active";

	const activateMutation = useMutation({
		mutationFn: () => projectService.update(projectId, { status: "active" }),
		onSuccess: () => {
			toast.success("Project activated");
			void qc.invalidateQueries({ queryKey: ["project", projectId] });
			onActivated?.();
		},
		onError: (err: Error) => toast.error(err.message),
	});

	if (isLoading) {
		return (
			<div className="flex justify-center py-8">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}
	if (!checklist) return null;

	const sorted = sortChecklistItems(checklist.items);
	const { done, total } = checklistProgress(checklist);
	const compact = mode === "compact";

	return (
		<div className={compact ? "" : "app-surface-card-strong rounded-2xl p-6"}>
			{!compact && (
				<>
					<div className="flex items-center justify-between">
						<h2 className="text-lg font-semibold text-foreground">
							Make this project live
						</h2>
						<span className="text-sm font-semibold text-muted-foreground">
							{done}/{total}
						</span>
					</div>
					<p className="mt-1 text-sm text-muted-foreground">
						An active project bills the client and pays the team, so everything
						billing depends on has to be in place first.
					</p>
				</>
			)}

			<ul className={compact ? "space-y-1.5" : "mt-5 space-y-2"}>
				{sorted.map((item) => (
					<li
						key={item.key}
						className={`flex items-start gap-2.5 rounded-lg ${
							compact
								? "px-1 py-1.5"
								: "border border-border bg-muted/30 px-3 py-2.5"
						}`}
					>
						{item.ok ? (
							<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
						) : item.severity === "warning" ? (
							<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
						) : (
							<Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
						)}
						<div className="min-w-0 flex-1">
							<p
								className={`font-medium text-foreground ${compact ? "text-[13px]" : "text-sm"}`}
							>
								{item.label}
							</p>
							{item.detail && !compact && (
								<p className="mt-0.5 text-xs text-muted-foreground">
									{item.detail}
								</p>
							)}
						</div>
						{!item.ok && item.fixPath && (
							<Link
								to={item.fixPath}
								onClick={() => onActivated?.()}
								className="shrink-0 text-xs font-semibold text-primary hover:underline"
							>
								Fix
							</Link>
						)}
					</li>
				))}
			</ul>

			<button
				type="button"
				onClick={() => activateMutation.mutate()}
				disabled={
					!checklist.ready || alreadyActive || activateMutation.isPending
				}
				className={`app-cta ${compact ? "mt-3 w-full justify-center" : "mt-5"} inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50`}
			>
				<Rocket className="h-4 w-4" />
				{alreadyActive
					? "Project is active"
					: activateMutation.isPending
						? "Activating…"
						: "Activate project"}
			</button>
		</div>
	);
}
