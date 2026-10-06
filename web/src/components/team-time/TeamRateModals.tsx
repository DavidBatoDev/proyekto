import { AlertTriangle, Save, Trash2, XCircle } from "lucide-react";
import { useId } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { CurrencySelect } from "@/components/common/CurrencySelect";
import type { TeamMember, TeamMemberRate } from "@/services/teams.service";
import {
	MemberRateTypeFields,
	type RateTypeDraft,
} from "./MemberRateTypeFields";

/**
 * The Rates page's add, edit and delete dialogs.
 *
 * Copied out of TeamTimeModals.tsx (which W3-1 retires with the rest of the
 * old per-log time UI) onto AppDialog and theme tokens, with the props kept as
 * they were. The copy follows the time rebuild: a rate no longer decides who
 * may track time; it prices the member's approved team time on the dates it
 * covers (start to end date, both inclusive).
 */

/** A project the team is attached to, as the rate dialogs need it. */
export interface RateProjectOption {
	id: string;
	title: string | null;
}

/** Copy shared by the dialogs (web only: rates are never shown in the app). */
export const TEAM_RATE_COPY = {
	addTitle: "Add a rate",
	addSubtitle:
		"Set what a member's time costs on the team's projects. Anyone on the team can track time with or without a rate.",
	editTitle: "Edit rate",
	deleteTitle: "Delete rate",
	deleteSubtitle: "This can't be undone.",
	noProjects:
		"No projects are attached to this team yet. Attach a project first, then come back to set a rate.",
	allCovered:
		"This member already has a current rate on every attached project. End one of them first to add another.",
	endDateTitle: "This rate stops on its end date",
	endDateBody:
		"It prices approved time up to and including that day, and it isn't the member's current rate. Time after it has no rate until you add the next one. Leave the end date empty to keep it current.",
	footnote:
		"A rate prices this member's approved time on these projects. Time with no rate in force carries no amount. Hour limits are set per project in the project's Time settings.",
} as const;

const inputClass =
	"w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";
const requiredMissingClass = "border-destructive/60";
const labelClass =
	"block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

function RequiredMark() {
	return (
		<span className="text-destructive" aria-hidden="true">
			{" "}
			*
		</span>
	);
}

function memberOptionLabel(member: TeamMember): string {
	const composed = [member.user?.first_name, member.user?.last_name]
		.filter(Boolean)
		.join(" ")
		.trim();
	return (
		member.user?.display_name ||
		composed ||
		member.user?.email ||
		member.user_id
	);
}

// ───────────────────────── Add rate ─────────────────────────

export interface AddRateModalProps {
	isOpen: boolean;
	canManageRates: boolean;
	eligibleMembers: TeamMember[];
	loadingMembers: boolean;
	savingRate: boolean;
	newRateMemberUserId: string;
	newRateCustomId: string;
	newRateValue: string;
	newRateTrainingValue: string;
	newRateCurrency: string;
	newRateStartDate: string;
	newRateEndDate: string;
	attachedProjects: RateProjectOption[];
	coveredProjectIds: string[];
	scopeMode: "all" | "specific";
	selectedProjectIds: string[];
	/** Hourly vs fixed pay for this member on the selected project(s). */
	rateTypeDraft: RateTypeDraft;
	onChangeRateTypeDraft: (updates: Partial<RateTypeDraft>) => void;
	onClose: () => void;
	onCreateRate: () => void | Promise<void>;
	onChangeMemberUserId: (value: string) => void;
	onChangeCustomId: (value: string) => void;
	onChangeRateValue: (value: string) => void;
	onChangeRateTrainingValue: (value: string) => void;
	onChangeRateCurrency: (value: string) => void;
	onChangeStartDate: (value: string) => void;
	onChangeEndDate: (value: string) => void;
	onChangeScopeMode: (value: "all" | "specific") => void;
	onChangeSelectedProjectIds: (ids: string[]) => void;
}

export function AddRateModal({
	isOpen,
	canManageRates,
	eligibleMembers,
	loadingMembers,
	savingRate,
	newRateMemberUserId,
	newRateCustomId,
	newRateValue,
	newRateTrainingValue,
	newRateCurrency,
	newRateStartDate,
	newRateEndDate,
	attachedProjects,
	coveredProjectIds,
	scopeMode,
	selectedProjectIds,
	rateTypeDraft,
	onChangeRateTypeDraft,
	onClose,
	onCreateRate,
	onChangeMemberUserId,
	onChangeCustomId,
	onChangeRateValue,
	onChangeRateTrainingValue,
	onChangeRateCurrency,
	onChangeStartDate,
	onChangeEndDate,
	onChangeScopeMode,
	onChangeSelectedProjectIds,
}: AddRateModalProps) {
	const ids = useId();
	const visible = isOpen && canManageRates;
	const coveredSet = new Set(coveredProjectIds);
	const availableProjects = attachedProjects.filter(
		(p) => !coveredSet.has(p.id),
	);
	const allAvailableProjectIds = availableProjects.map((p) => p.id);
	const noProjectsAttached = attachedProjects.length === 0;
	const noProjectsAvailable = availableProjects.length === 0;
	const effectiveProjectIds =
		scopeMode === "all"
			? allAvailableProjectIds
			: selectedProjectIds.filter((id) => !coveredSet.has(id));
	const canSave =
		!savingRate &&
		!loadingMembers &&
		!!newRateMemberUserId &&
		!!newRateValue &&
		!!newRateTrainingValue &&
		!!newRateCurrency &&
		!!newRateStartDate &&
		effectiveProjectIds.length > 0;
	const toggleProject = (id: string) => {
		const set = new Set(selectedProjectIds);
		if (set.has(id)) set.delete(id);
		else set.add(id);
		onChangeSelectedProjectIds(Array.from(set));
	};
	const segment = (active: boolean) =>
		active
			? "rounded-md bg-card px-3 py-1 text-xs font-medium text-foreground shadow-sm disabled:opacity-50"
			: "rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50";

	return (
		<AppDialog
			open={visible}
			onClose={onClose}
			busy={savingRate}
			size="lg"
			title={TEAM_RATE_COPY.addTitle}
			description={TEAM_RATE_COPY.addSubtitle}
			footer={
				<>
					<button
						type="button"
						onClick={onClose}
						disabled={savingRate}
						className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
					>
						<XCircle className="h-3.5 w-3.5" aria-hidden="true" />
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void onCreateRate()}
						disabled={!canSave}
						className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						<Save className="h-3.5 w-3.5" aria-hidden="true" />
						Save rate
					</button>
				</>
			}
		>
			<div className="space-y-4">
				<div className="space-y-1.5">
					<label htmlFor={`${ids}-member`} className={labelClass}>
						Member
					</label>
					<select
						id={`${ids}-member`}
						value={newRateMemberUserId}
						onChange={(e) => onChangeMemberUserId(e.target.value)}
						disabled={savingRate || loadingMembers}
						className={inputClass}
					>
						<option value="">Select member</option>
						{eligibleMembers.map((member) => (
							<option key={member.id} value={member.user_id}>
								{memberOptionLabel(member)} ({member.role})
							</option>
						))}
					</select>
				</div>

				<div className="space-y-2">
					<span className={labelClass}>Apply to projects</span>
					{noProjectsAttached ? (
						<div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
							{TEAM_RATE_COPY.noProjects}
						</div>
					) : (
						<>
							<div
								role="radiogroup"
								aria-label="Apply to projects"
								className="inline-flex items-center rounded-lg bg-muted p-0.5"
							>
								<button
									type="button"
									role="radio"
									aria-checked={scopeMode === "all"}
									onClick={() => onChangeScopeMode("all")}
									disabled={savingRate || noProjectsAvailable}
									className={segment(scopeMode === "all")}
								>
									All available projects
								</button>
								<button
									type="button"
									role="radio"
									aria-checked={scopeMode === "specific"}
									onClick={() => onChangeScopeMode("specific")}
									disabled={savingRate}
									className={segment(scopeMode === "specific")}
								>
									Specific projects
								</button>
							</div>
							<div className="max-h-40 overflow-auto rounded-lg border border-border bg-card p-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
								{attachedProjects.map((p) => {
									const covered = coveredSet.has(p.id);
									const isChecked =
										scopeMode === "all"
											? !covered
											: selectedProjectIds.includes(p.id);
									return (
										<label
											key={p.id}
											className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs ${
												covered
													? "text-muted-foreground"
													: "cursor-pointer text-foreground hover:bg-muted"
											}`}
										>
											<span className="flex min-w-0 items-center gap-2">
												<input
													type="checkbox"
													checked={isChecked}
													disabled={
														savingRate || covered || scopeMode === "all"
													}
													onChange={() => toggleProject(p.id)}
												/>
												<span className="truncate">
													{p.title || "(untitled)"}
												</span>
											</span>
											{covered && (
												<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
													Has a current rate
												</span>
											)}
										</label>
									);
								})}
							</div>
							{newRateMemberUserId && noProjectsAvailable && (
								<p className="text-[11px] text-warning">
									{TEAM_RATE_COPY.allCovered}
								</p>
							)}
						</>
					)}
				</div>

				<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
					<div className="space-y-1.5">
						<label htmlFor={`${ids}-custom`} className={labelClass}>
							Custom ID
						</label>
						<input
							id={`${ids}-custom`}
							type="text"
							value={newRateCustomId}
							onChange={(e) => onChangeCustomId(e.target.value)}
							placeholder="Employee or contractor ID"
							disabled={savingRate}
							className={inputClass}
						/>
					</div>
					<div className="space-y-1.5 md:col-span-2">
						<MemberRateTypeFields
							draft={rateTypeDraft}
							onChange={onChangeRateTypeDraft}
							disabled={savingRate}
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor={`${ids}-work`} className={labelClass}>
							Work rate
							<RequiredMark />
						</label>
						<input
							id={`${ids}-work`}
							type="number"
							min={0}
							step="0.01"
							value={newRateValue}
							onChange={(e) => onChangeRateValue(e.target.value)}
							placeholder="e.g. 25.00"
							disabled={savingRate}
							required
							className={`${inputClass} ${newRateValue ? "" : requiredMissingClass}`}
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor={`${ids}-training`} className={labelClass}>
							Training rate
							<RequiredMark />
						</label>
						<input
							id={`${ids}-training`}
							type="number"
							min={0}
							step="0.01"
							value={newRateTrainingValue}
							onChange={(e) => onChangeRateTrainingValue(e.target.value)}
							placeholder="e.g. 15.00"
							disabled={savingRate}
							required
							className={`${inputClass} ${newRateTrainingValue ? "" : requiredMissingClass}`}
						/>
					</div>
					<div className="space-y-1.5">
						<span className={labelClass}>
							Currency
							<RequiredMark />
						</span>
						<CurrencySelect
							value={newRateCurrency || "USD"}
							onChange={onChangeRateCurrency}
							disabled={savingRate}
						/>
					</div>
				</div>

				<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
					<div className="space-y-1.5">
						<label htmlFor={`${ids}-start`} className={labelClass}>
							Start date
							<RequiredMark />
						</label>
						<input
							id={`${ids}-start`}
							type="date"
							value={newRateStartDate}
							onChange={(e) => onChangeStartDate(e.target.value)}
							disabled={savingRate}
							required
							className={`${inputClass} ${newRateStartDate ? "" : requiredMissingClass}`}
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor={`${ids}-end`} className={labelClass}>
							End date (optional)
						</label>
						<input
							id={`${ids}-end`}
							type="date"
							value={newRateEndDate}
							onChange={(e) => onChangeEndDate(e.target.value)}
							disabled={savingRate}
							className={inputClass}
						/>
					</div>
				</div>

				{newRateEndDate ? <EndDateNotice /> : null}

				<div className="rounded-xl border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
					{TEAM_RATE_COPY.footnote}
				</div>
			</div>
		</AppDialog>
	);
}

/**
 * A rate prices time dated on or before its end date (the freeze reads the
 * rate in force on each entry's day: start ≤ day ≤ end). It is no longer the
 * member's "current" rate, which is what the list and the one-current-rate
 * rule key off. Say both before it saves.
 */
function EndDateNotice() {
	return (
		<div
			role="status"
			className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground"
		>
			<AlertTriangle
				className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
				aria-hidden="true"
			/>
			<div>
				<div className="font-semibold">{TEAM_RATE_COPY.endDateTitle}</div>
				<p className="mt-0.5">{TEAM_RATE_COPY.endDateBody}</p>
			</div>
		</div>
	);
}

// ───────────────────────── Edit rate ─────────────────────────

export interface EditRateModalProps {
	isOpen: boolean;
	canManageRates: boolean;
	editingRate: TeamMemberRate | null;
	memberLabel: string;
	editingRateCustomId: string;
	editingRateValue: string;
	editingRateTrainingValue: string;
	editingRateCurrency: string;
	editingRateStartDate: string;
	editingRateEndDate: string;
	savingRate: boolean;
	rateTypeDraft: RateTypeDraft;
	onChangeRateTypeDraft: (updates: Partial<RateTypeDraft>) => void;
	onClose: () => void;
	onSave: () => void | Promise<void>;
	onRequestDelete: () => void;
	onChangeCustomId: (value: string) => void;
	onChangeRateValue: (value: string) => void;
	onChangeRateTrainingValue: (value: string) => void;
	onChangeRateCurrency: (value: string) => void;
	onChangeStartDate: (value: string) => void;
	onChangeEndDate: (value: string) => void;
}

export function EditRateModal({
	isOpen,
	canManageRates,
	editingRate,
	memberLabel,
	editingRateCustomId,
	editingRateValue,
	editingRateTrainingValue,
	editingRateCurrency,
	editingRateStartDate,
	editingRateEndDate,
	savingRate,
	rateTypeDraft,
	onChangeRateTypeDraft,
	onClose,
	onSave,
	onRequestDelete,
	onChangeCustomId,
	onChangeRateValue,
	onChangeRateTrainingValue,
	onChangeRateCurrency,
	onChangeStartDate,
	onChangeEndDate,
}: EditRateModalProps) {
	const ids = useId();
	const visible = isOpen && canManageRates && Boolean(editingRate);
	const memberName = memberLabel || "Unknown member";
	// A rate that already had an end date was history before this edit.
	const endingNow =
		Boolean(editingRateEndDate) && editingRate?.end_date !== editingRateEndDate;

	return (
		<AppDialog
			open={visible}
			onClose={onClose}
			busy={savingRate}
			size="lg"
			title={TEAM_RATE_COPY.editTitle}
			description={memberName}
			footer={
				<div className="flex w-full items-center justify-between gap-2">
					<button
						type="button"
						onClick={onRequestDelete}
						disabled={savingRate}
						className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2 text-xs font-semibold text-destructive hover:bg-destructive/15 disabled:opacity-50"
					>
						<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
						Delete rate
					</button>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onClose}
							disabled={savingRate}
							className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
						>
							<XCircle className="h-3.5 w-3.5" aria-hidden="true" />
							Cancel
						</button>
						<button
							type="button"
							onClick={() => void onSave()}
							disabled={
								savingRate ||
								!editingRateStartDate ||
								!editingRateValue ||
								!editingRateCurrency
							}
							className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							<Save className="h-3.5 w-3.5" aria-hidden="true" />
							Save changes
						</button>
					</div>
				</div>
			}
		>
			<div className="space-y-4">
				<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
					<div className="space-y-1.5">
						<label htmlFor={`${ids}-custom`} className={labelClass}>
							Custom ID
						</label>
						<input
							id={`${ids}-custom`}
							type="text"
							value={editingRateCustomId}
							onChange={(e) => onChangeCustomId(e.target.value)}
							disabled={savingRate}
							className={inputClass}
						/>
					</div>
					<div className="space-y-1.5 md:col-span-2">
						<MemberRateTypeFields
							draft={rateTypeDraft}
							onChange={onChangeRateTypeDraft}
							disabled={savingRate}
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor={`${ids}-work`} className={labelClass}>
							Work rate
							<RequiredMark />
						</label>
						<input
							id={`${ids}-work`}
							type="number"
							min={0}
							step="0.01"
							value={editingRateValue}
							onChange={(e) => onChangeRateValue(e.target.value)}
							disabled={savingRate}
							required
							className={`${inputClass} ${editingRateValue ? "" : requiredMissingClass}`}
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor={`${ids}-training`} className={labelClass}>
							Training rate
							<RequiredMark />
						</label>
						<input
							id={`${ids}-training`}
							type="number"
							min={0}
							step="0.01"
							value={editingRateTrainingValue}
							onChange={(e) => onChangeRateTrainingValue(e.target.value)}
							disabled={savingRate}
							required
							className={`${inputClass} ${editingRateTrainingValue ? "" : requiredMissingClass}`}
						/>
					</div>
					<div className="space-y-1.5">
						<span className={labelClass}>
							Currency
							<RequiredMark />
						</span>
						<CurrencySelect
							value={editingRateCurrency || "USD"}
							onChange={onChangeRateCurrency}
							disabled={savingRate}
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor={`${ids}-start`} className={labelClass}>
							Start date
							<RequiredMark />
						</label>
						<input
							id={`${ids}-start`}
							type="date"
							value={editingRateStartDate}
							onChange={(e) => onChangeStartDate(e.target.value)}
							disabled={savingRate}
							required
							className={`${inputClass} ${editingRateStartDate ? "" : requiredMissingClass}`}
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor={`${ids}-end`} className={labelClass}>
							End date (optional)
						</label>
						<input
							id={`${ids}-end`}
							type="date"
							value={editingRateEndDate}
							onChange={(e) => onChangeEndDate(e.target.value)}
							disabled={savingRate}
							className={inputClass}
						/>
					</div>
				</div>

				{endingNow ? <EndDateNotice /> : null}
			</div>
		</AppDialog>
	);
}

// ───────────────────────── Delete rate ─────────────────────────

export interface DeleteRateModalProps {
	isOpen: boolean;
	targetLabel?: string;
	verificationText: string;
	deletingRate: boolean;
	onClose: () => void;
	onChangeVerificationText: (value: string) => void;
	onConfirmDelete: () => void | Promise<void>;
}

export function DeleteRateModal({
	isOpen,
	targetLabel,
	verificationText,
	deletingRate,
	onClose,
	onChangeVerificationText,
	onConfirmDelete,
}: DeleteRateModalProps) {
	const inputId = useId();
	const confirmed = verificationText.trim().toUpperCase() === "DELETE";

	return (
		<AppDialog
			open={isOpen}
			onClose={onClose}
			busy={deletingRate}
			size="md"
			title={TEAM_RATE_COPY.deleteTitle}
			description={TEAM_RATE_COPY.deleteSubtitle}
			footer={
				<>
					<button
						type="button"
						onClick={onClose}
						disabled={deletingRate}
						className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
					>
						<XCircle className="h-3.5 w-3.5" aria-hidden="true" />
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void onConfirmDelete()}
						disabled={deletingRate || !confirmed}
						className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
					>
						<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
						Delete rate
					</button>
				</>
			}
		>
			<div className="space-y-3">
				{targetLabel && (
					<p className="text-xs text-muted-foreground">
						You're deleting a rate for{" "}
						<span className="font-semibold text-foreground">{targetLabel}</span>
						.
					</p>
				)}
				<label
					htmlFor={inputId}
					className="block text-xs text-muted-foreground"
				>
					Type <span className="font-bold text-foreground">DELETE</span> to
					confirm.
				</label>
				<input
					id={inputId}
					type="text"
					value={verificationText}
					onChange={(e) => onChangeVerificationText(e.target.value)}
					placeholder="Type DELETE"
					className="w-full rounded-md border border-destructive/40 bg-card px-3 py-2 text-sm text-foreground"
				/>
			</div>
		</AppDialog>
	);
}
