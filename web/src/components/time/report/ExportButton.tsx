import { useMutation } from "@tanstack/react-query";
import { Download, Loader2, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	featureLimitInfo,
	PlanLimitNotice,
} from "@/components/billing/PlanLimitNotice";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useToast } from "@/hooks/useToast";
import { isNativeApp } from "@/lib/platform";
import { timeErrorCopy, timePlanCopy } from "@/lib/timeErrors";
import { cn } from "@/lib/utils";
import {
	isTimeApiError,
	saveTimeExport,
	timeService,
} from "@/services/time.service";
import type {
	ReportExportQuery,
	TimeExportFormat,
} from "@/services/time.types";
import {
	noticeWorkspace,
	REPORT_COPY,
	type ReportPlanWorkspace,
} from "./reportModel";

/**
 * Exports the report as it is filtered (`GET time/reports/export`, Business:
 * `time_reports_export`). The server applies the screen's authority query and
 * column gating (L45): cost columns only for cost viewers, titles per L21,
 * identity per L22.
 *
 * - When the caller names the plan's workspace, a plan without the feature is
 *   known ahead: the button shows a lock and opens the plan notice instead.
 * - A refusal the server still makes (403 `plan_limit`) is announced by the
 *   service's global plan prompt, so it is not toasted twice.
 * - Native renders nothing: the file carries cost columns, and the installed
 *   app has no file download.
 */
export interface ExportButtonProps {
	query: ReportExportQuery;
	/**
	 * The scope's plan subject (team → its workspace; workspace → itself).
	 * Without it the plan is not checked ahead and the server decides.
	 */
	planWorkspace?: ReportPlanWorkspace | null;
	disabled?: boolean;
	className?: string;
}

const FORMATS: Array<{ format: TimeExportFormat; label: string }> = [
	{ format: "csv", label: REPORT_COPY.exportCsv },
	{ format: "xlsx", label: REPORT_COPY.exportXlsx },
];

export function ExportButton({
	query,
	planWorkspace,
	disabled = false,
	className,
}: ExportButtonProps) {
	const native = isNativeApp();
	const toast = useToast();
	const entitlements = useEntitlements(native ? null : planWorkspace?.id);
	const planInfo = featureLimitInfo(entitlements, "time_reports_export");
	const [open, setOpen] = useState(false);
	const wrapRef = useRef<HTMLDivElement | null>(null);

	const exportMutation = useMutation({
		mutationFn: (format: TimeExportFormat) =>
			timeService.exportReport({ ...query, format }),
		onSuccess: (file) => {
			saveTimeExport(file);
		},
		onError: (error) => {
			if (isTimeApiError(error) && error.planLimit) return;
			toast.error(
				timeErrorCopy(error, { subject: "scope", operation: "read" }).message,
			);
		},
	});

	useEffect(() => {
		if (!open) return;
		const onPointer = (event: MouseEvent) => {
			if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	if (native) return null;

	const busy = exportMutation.isPending;

	return (
		<div ref={wrapRef} className={cn("relative", className)}>
			<button
				type="button"
				aria-haspopup={planInfo ? "dialog" : "menu"}
				aria-expanded={open}
				disabled={disabled || busy}
				onClick={() => setOpen((v) => !v)}
				className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
			>
				{busy ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
				) : planInfo ? (
					<Lock className="h-3.5 w-3.5" aria-hidden="true" />
				) : (
					<Download className="h-3.5 w-3.5" aria-hidden="true" />
				)}
				{busy ? REPORT_COPY.exporting : REPORT_COPY.export}
			</button>
			{open && planInfo ? (
				<div className="absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))]">
					<PlanLimitNotice
						info={planInfo}
						workspace={noticeWorkspace(planWorkspace)}
						message={timePlanCopy("time_reports_export", {
							workspaceName: planWorkspace?.name,
							native,
						})}
						isComplimentary={entitlements.isComplimentary}
						variant="inline"
						className="shadow-lg"
					/>
				</div>
			) : null}
			{open && !planInfo ? (
				<div
					role="menu"
					aria-label={REPORT_COPY.export}
					className="absolute right-0 top-full z-40 mt-2 min-w-[10rem] overflow-hidden rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-lg"
				>
					{FORMATS.map((item) => (
						<button
							key={item.format}
							type="button"
							role="menuitem"
							onClick={() => {
								setOpen(false);
								exportMutation.mutate(item.format);
							}}
							className="block w-full px-3 py-1.5 text-left text-xs font-medium hover:bg-muted"
						>
							{item.label}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
