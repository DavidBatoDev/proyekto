import { ArrowUpRight, CalendarOff, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { DateField } from "@/components/common/DateField";
import { EpicGlyph, FeatureGlyph } from "@/components/roadmap/shared/NodeGlyph";
import {
	fmtEpicDateRange,
	getInclusiveDays,
	toISODateString,
} from "../../milestones/model/utils";
import { STATUS_LABELS } from "../components/TimelineFilterMenu";
import { getRowDates, rowDisplayKey, type TimelineRow } from "../model/rows";

export interface MobileDateCommit {
	row: TimelineRow;
	startDate: string;
	endDate: string;
}

interface MobileTimelineDetailSheetProps {
	row: TimelineRow | null;
	canEditDates: boolean;
	isSaving: boolean;
	/** Earliest legal start, when a dependency conflict has proposed one. */
	conflictFixDate: string | null;
	onCommitDates: (commit: MobileDateCommit) => void;
	onClearDates: (row: TimelineRow) => void;
	onOpenRow: (row: TimelineRow) => void;
	onClose: () => void;
}

/**
 * Everything mobile does to a bar, in one sheet.
 *
 * The desktop chart edits dates by dragging bars and their 8px edges — both
 * unusable on touch, and worse than unusable in the case of `move`, which would
 * fire on any attempt to scroll the chart and silently reschedule real work.
 * Mobile therefore hands the whole edit to two date pickers behind an explicit
 * Save, and leaves the bars themselves inert.
 *
 * `DateField` emits `YYYY-MM-DD`, which is exactly what `persistDateChange`
 * already sends to `PATCH /api/features/:id`, so this reuses the existing write
 * path rather than opening a second one.
 */
export const MobileTimelineDetailSheet = ({
	row,
	canEditDates,
	isSaving,
	conflictFixDate,
	onCommitDates,
	onClearDates,
	onOpenRow,
	onClose,
}: MobileTimelineDetailSheetProps) => {
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");

	const stored = row ? getRowDates(row) : null;

	// Re-seed the draft whenever a different row opens the sheet, or the stored
	// dates change underneath it (a collaborator's edit, or our own commit
	// landing).
	useEffect(() => {
		setStartDate(stored?.startDate ?? "");
		setEndDate(stored?.endDate ?? "");
	}, [stored?.startDate, stored?.endDate]);

	if (!row) return null;

	const entity = row.kind === "epic" ? row.epic : row.feature;
	const title = row.kind === "epic" ? row.epic.title : row.feature.title;
	const status = row.kind === "feature" ? row.feature.status : null;

	const hasBothDates = Boolean(startDate && endDate);
	// The sheet is the only place mobile can express a range, so it has to guard
	// the inversion the desktop drag handles clamp away.
	const isInverted = hasBothDates && startDate > endDate;
	const isDirty =
		startDate !== (stored?.startDate ?? "") ||
		endDate !== (stored?.endDate ?? "");
	const canSave = canEditDates && hasBothDates && !isInverted && isDirty;

	const rangeLabel =
		stored &&
		fmtEpicDateRange(new Date(stored.startDate), new Date(stored.endDate));
	const dayCount =
		stored &&
		getInclusiveDays(new Date(stored.startDate), new Date(stored.endDate));

	return (
		<AppDialog
			open
			onClose={onClose}
			variant="bottom-sheet"
			busy={isSaving}
			hideCloseButton
			footer={
				<div className="flex items-center justify-between gap-3">
					<button
						type="button"
						onClick={() => onOpenRow(row)}
						className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-600"
					>
						Open {row.kind === "epic" ? "epic" : "feature"}
						<ArrowUpRight className="h-4 w-4" />
					</button>
					{canEditDates && (
						<button
							type="button"
							disabled={!canSave || isSaving}
							onClick={() => onCommitDates({ row, startDate, endDate })}
							className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
						>
							{isSaving ? "Saving…" : "Save"}
						</button>
					)}
				</div>
			}
		>
			<div className="space-y-4 px-5 py-4">
				<header className="flex items-start gap-2.5">
					<span className="mt-0.5 shrink-0">
						{row.kind === "epic" ? <EpicGlyph /> : <FeatureGlyph />}
					</span>
					<div className="min-w-0 flex-1">
						<h2 className="text-[15px] font-semibold leading-snug text-gray-900">
							{title}
						</h2>
						<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-gray-500">
							<span className="tabular-nums">{rowDisplayKey(row)}</span>
							{status && (
								<>
									<span aria-hidden="true">·</span>
									<span>{STATUS_LABELS[status]}</span>
								</>
							)}
							{rangeLabel && (
								<>
									<span aria-hidden="true">·</span>
									<span>
										{rangeLabel} ({dayCount}d)
									</span>
								</>
							)}
						</div>
					</div>
				</header>

				{entity.description && (
					<p className="line-clamp-3 text-[13px] leading-relaxed text-gray-600">
						{entity.description}
					</p>
				)}

				{conflictFixDate && (
					<div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800">
						<TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
						<div className="min-w-0 flex-1">
							<p>
								This starts before the work it depends on finishes. The earliest
								clear start is{" "}
								{fmtEpicDateRange(
									new Date(conflictFixDate),
									new Date(conflictFixDate),
								)}
								.
							</p>
							{canEditDates && stored && (
								<button
									type="button"
									onClick={() => {
										const days = getInclusiveDays(
											new Date(stored.startDate),
											new Date(stored.endDate),
										);
										const nextStart = new Date(conflictFixDate);
										const nextEnd = new Date(conflictFixDate);
										nextEnd.setDate(nextEnd.getDate() + days - 1);
										setStartDate(toISODateString(nextStart));
										setEndDate(toISODateString(nextEnd));
									}}
									className="mt-1.5 font-semibold underline"
								>
									Move it there
								</button>
							)}
						</div>
					</div>
				)}

				{canEditDates ? (
					<div className="space-y-3">
						<div className="grid grid-cols-2 gap-3">
							<DateField
								label="Start"
								value={startDate}
								onChange={setStartDate}
								disabled={isSaving}
							/>
							<DateField
								label="End"
								value={endDate}
								onChange={setEndDate}
								disabled={isSaving}
							/>
						</div>

						{isInverted && (
							<p className="text-[12px] font-medium text-red-600">
								The end date needs to fall on or after the start date.
							</p>
						)}

						{stored && (
							<button
								type="button"
								disabled={isSaving}
								onClick={() => onClearDates(row)}
								className="inline-flex items-center gap-1.5 text-[13px] font-medium text-gray-500 disabled:opacity-40"
							>
								<CalendarOff className="h-4 w-4" />
								Remove from timeline
							</button>
						)}
					</div>
				) : (
					!stored && (
						<p className="text-[13px] text-gray-500">
							This {row.kind} has no dates yet.
						</p>
					)
				)}
			</div>
		</AppDialog>
	);
};
