import { Loader2, Save, Search, Trash2, X, XCircle, Folder, Layers, Layout, CheckCircle2, ChevronRight, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type {
	ProjectTaskOption,
	TeamLogProject,
} from "@/services/team-time.service";
import type { TeamMember, TeamMemberRate } from "@/services/teams.service";

const MODAL_BACKDROP_MOTION = {
	initial: { opacity: 0 },
	animate: { opacity: 1 },
	exit: { opacity: 0 },
	transition: { duration: 0.18, ease: "easeOut" as const },
};
const MODAL_PANEL_MOTION = {
	initial: { opacity: 0, scale: 0.96, y: 8 },
	animate: { opacity: 1, scale: 1, y: 0 },
	exit: { opacity: 0, scale: 0.96, y: 8 },
	transition: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] },
};

// ───────────────────────── Edit Log ─────────────────────────

interface EditLogModalProps {
	isOpen: boolean;
	startedAt: string;
	endedAt: string;
	saving: boolean;
	onClose: () => void;
	onSave: () => void | Promise<void>;
	onChangeStartedAt: (value: string) => void;
	onChangeEndedAt: (value: string) => void;
}

export function EditLogModal({
	isOpen,
	startedAt,
	endedAt,
	saving,
	onClose,
	onSave,
	onChangeStartedAt,
	onChangeEndedAt,
}: EditLogModalProps) {
	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-165 flex items-center justify-center bg-slate-900/55 backdrop-blur-[2px] p-4"
			onClick={onClose}
		>
			<div
				className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
					<div>
						<h3 className="text-base font-semibold text-gray-900">Edit Log</h3>
						<p className="text-xs text-gray-500 mt-1">
							Update time-in and time-out.
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				<div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
					<div className="space-y-1.5">
						<label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
							Time-in
						</label>
						<input
							type="datetime-local"
							value={startedAt}
							onChange={(e) => onChangeStartedAt(e.target.value)}
							className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
						/>
					</div>
					<div className="space-y-1.5">
						<label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
							Time-Out
						</label>
						<input
							type="datetime-local"
							value={endedAt}
							onChange={(e) => onChangeEndedAt(e.target.value)}
							className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
						/>
					</div>
				</div>

				<div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4 bg-gray-50">
					<button
						type="button"
						onClick={onClose}
						disabled={saving}
						className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50"
					>
						<XCircle className="w-3.5 h-3.5" />
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void onSave()}
						disabled={saving}
						className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
					>
						<Save className="w-3.5 h-3.5" />
						Save Changes
					</button>
				</div>
			</div>
		</div>
	);
}

// ───────────────────────── Add Rate ─────────────────────────

interface AddRateModalProps {
	isOpen: boolean;
	canManageRates: boolean;
	eligibleMembers: TeamMember[];
	loadingMembers: boolean;
	savingRate: boolean;
	newRateMemberUserId: string;
	newRateCustomId: string;
	newRateValue: string;
	newRateCurrency: string;
	newRateStartDate: string;
	newRateEndDate: string;
	attachedProjects: TeamLogProject[];
	coveredProjectIds: string[];
	scopeMode: "all" | "specific";
	selectedProjectIds: string[];
	onClose: () => void;
	onCreateRate: () => void | Promise<void>;
	onChangeMemberUserId: (value: string) => void;
	onChangeCustomId: (value: string) => void;
	onChangeRateValue: (value: string) => void;
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
	newRateCurrency,
	newRateStartDate,
	newRateEndDate,
	attachedProjects,
	coveredProjectIds,
	scopeMode,
	selectedProjectIds,
	onClose,
	onCreateRate,
	onChangeMemberUserId,
	onChangeCustomId,
	onChangeRateValue,
	onChangeRateCurrency,
	onChangeStartDate,
	onChangeEndDate,
	onChangeScopeMode,
	onChangeSelectedProjectIds,
}: AddRateModalProps) {
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
		!!newRateCurrency &&
		!!newRateStartDate &&
		effectiveProjectIds.length > 0;
	const toggleProject = (id: string) => {
		const set = new Set(selectedProjectIds);
		if (set.has(id)) set.delete(id);
		else set.add(id);
		onChangeSelectedProjectIds(Array.from(set));
	};

	return (
		<AnimatePresence>
			{visible && (
				<motion.div
					key="add-rate-modal"
					className="fixed inset-0 z-160 flex items-center justify-center bg-slate-900/55 backdrop-blur-[2px] p-4"
					onClick={onClose}
					{...MODAL_BACKDROP_MOTION}
				>
					<motion.div
						className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-3xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(2,6,23,0.35)] overflow-hidden"
						onClick={(e) => e.stopPropagation()}
						{...MODAL_PANEL_MOTION}
					>
						<div className="flex items-center justify-between border-b border-slate-200 px-6 py-5 bg-linear-to-r from-slate-50 to-white">
							<div>
								<h3 className="text-base font-semibold text-slate-900">
									Add Team Rate
								</h3>
						<p className="text-xs text-slate-500 mt-1">
							Enable time tracking for a team member by assigning an hourly rate.
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg p-1.5 text-slate-500 hover:bg-white/70"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				<div className="flex-1 overflow-y-auto p-6 space-y-4">
					<div className="space-y-1.5">
						<label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
							Select Member
						</label>
						<select
							value={newRateMemberUserId}
							onChange={(e) => onChangeMemberUserId(e.target.value)}
							disabled={savingRate || loadingMembers}
							className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
						>
							<option value="">Select member</option>
							{eligibleMembers.map((member) => {
								const memberName =
									member.user?.display_name ||
									member.user?.email ||
									member.user_id;
								return (
									<option key={member.id} value={member.user_id}>
										{memberName} ({member.role})
									</option>
								);
							})}
						</select>
					</div>

					<div className="space-y-2">
						<label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
							Apply to projects
						</label>
						{noProjectsAttached ? (
							<div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
								No projects are attached to this team yet. Attach a project
								first, then come back to set a rate.
							</div>
						) : (
							<>
								<div
									role="radiogroup"
									className="inline-flex items-center rounded-lg bg-slate-100 p-0.5"
								>
									<button
										type="button"
										role="radio"
										aria-checked={scopeMode === "all"}
										onClick={() => onChangeScopeMode("all")}
										disabled={savingRate || noProjectsAvailable}
										className={
											scopeMode === "all"
												? "rounded-md bg-white px-3 py-1 text-xs font-medium text-slate-900 shadow-sm disabled:opacity-50"
												: "rounded-md px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
										}
									>
										All available projects
									</button>
									<button
										type="button"
										role="radio"
										aria-checked={scopeMode === "specific"}
										onClick={() => onChangeScopeMode("specific")}
										disabled={savingRate}
										className={
											scopeMode === "specific"
												? "rounded-md bg-white px-3 py-1 text-xs font-medium text-slate-900 shadow-sm"
												: "rounded-md px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-700"
										}
									>
										Specific projects
									</button>
								</div>
								<div className="max-h-40 overflow-auto rounded-lg border border-slate-200 bg-white p-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
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
														? "text-slate-400"
														: "text-slate-700 hover:bg-slate-50 cursor-pointer"
												}`}
											>
												<span className="flex items-center gap-2">
													<input
														type="checkbox"
														checked={isChecked}
														disabled={
															savingRate ||
															covered ||
															scopeMode === "all"
														}
														onChange={() => toggleProject(p.id)}
													/>
													<span className="truncate">
														{p.title || "(untitled)"}
													</span>
												</span>
												{covered && (
													<span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
														Has active rate
													</span>
												)}
											</label>
										);
									})}
								</div>
								{newRateMemberUserId && noProjectsAvailable && (
									<p className="text-[11px] text-amber-700">
										This member already has an active rate on every attached
										project. End an existing rate first to add another.
									</p>
								)}
							</>
						)}
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
								Custom ID
							</label>
							<input
								type="text"
								value={newRateCustomId}
								onChange={(e) => onChangeCustomId(e.target.value)}
								placeholder="Employee/Freelancer ID"
								disabled={savingRate}
								className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
							/>
						</div>
						<div className="space-y-1.5">
							<label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
								Hourly Rate <span className="text-rose-500">*</span>
							</label>
							<input
								type="number"
								min={0}
								step="0.01"
								value={newRateValue}
								onChange={(e) => onChangeRateValue(e.target.value)}
								placeholder="e.g. 25.00"
								disabled={savingRate}
								required
								className={`w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 ${
									newRateValue ? "border-slate-300" : "border-rose-300"
								}`}
							/>
						</div>
						<div className="space-y-1.5">
							<label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
								Currency <span className="text-rose-500">*</span>
							</label>
							<input
								type="text"
								value={newRateCurrency}
								onChange={(e) =>
									onChangeRateCurrency(e.target.value.toUpperCase())
								}
								placeholder="USD"
								maxLength={8}
								disabled={savingRate}
								required
								className={`w-full px-3 py-2.5 text-sm border rounded-lg uppercase focus:outline-none focus:ring-2 focus:ring-slate-300 ${
									newRateCurrency ? "border-slate-300" : "border-rose-300"
								}`}
							/>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
								Start Date <span className="text-rose-500">*</span>
							</label>
							<input
								type="date"
								value={newRateStartDate}
								onChange={(e) => onChangeStartDate(e.target.value)}
								disabled={savingRate}
								required
								className={`w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 ${
									newRateStartDate ? "border-slate-300" : "border-rose-300"
								}`}
							/>
						</div>
						<div className="space-y-1.5">
							<label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
								End Date (Optional)
							</label>
							<input
								type="date"
								value={newRateEndDate}
								onChange={(e) => onChangeEndDate(e.target.value)}
								disabled={savingRate}
								className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
							/>
						</div>
					</div>

					<div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
						Members with no rate row cannot use the My Logs tab or timer
						actions.
					</div>
				</div>

				<div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 bg-slate-50">
					<button
						type="button"
						onClick={onClose}
						disabled={savingRate}
						className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50"
					>
						<XCircle className="w-3.5 h-3.5" />
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void onCreateRate()}
						disabled={!canSave}
						className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md border border-slate-700 bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
					>
						<Save className="w-3.5 h-3.5" />
						Save Rate
					</button>
				</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

// ───────────────────────── Edit Rate ─────────────────────────

interface EditRateModalProps {
	isOpen: boolean;
	canManageRates: boolean;
	editingRate: TeamMemberRate | null;
	memberLabel: string;
	editingRateCustomId: string;
	editingRateValue: string;
	editingRateCurrency: string;
	editingRateStartDate: string;
	editingRateEndDate: string;
	savingRate: boolean;
	onClose: () => void;
	onSave: () => void | Promise<void>;
	onRequestDelete: () => void;
	onChangeCustomId: (value: string) => void;
	onChangeRateValue: (value: string) => void;
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
	editingRateCurrency,
	editingRateStartDate,
	editingRateEndDate,
	savingRate,
	onClose,
	onSave,
	onRequestDelete,
	onChangeCustomId,
	onChangeRateValue,
	onChangeRateCurrency,
	onChangeStartDate,
	onChangeEndDate,
}: EditRateModalProps) {
	const visible = isOpen && canManageRates && Boolean(editingRate);
	const memberName = memberLabel || "Unknown member";

	return (
		<AnimatePresence>
			{visible && editingRate && (
				<motion.div
					key="edit-rate-modal"
					className="fixed inset-0 z-170 flex items-center justify-center bg-slate-900/55 backdrop-blur-[2px] p-4"
					onClick={onClose}
					{...MODAL_BACKDROP_MOTION}
				>
					<motion.div
						className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-3xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(2,6,23,0.35)] overflow-hidden"
						onClick={(e) => e.stopPropagation()}
						{...MODAL_PANEL_MOTION}
					>
						<div className="flex items-center justify-between border-b border-slate-200 px-6 py-5 bg-linear-to-r from-slate-50 to-white">
							<div>
								<h3 className="text-base font-semibold text-slate-900">
									Edit Team Rate
								</h3>
						<p className="text-xs text-slate-500 mt-1">{memberName}</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg p-1.5 text-slate-500 hover:bg-white/70"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				<div className="flex-1 overflow-y-auto p-6 space-y-4">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
								Custom ID
							</label>
							<input
								type="text"
								value={editingRateCustomId}
								onChange={(e) => onChangeCustomId(e.target.value)}
								className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
							/>
						</div>
						<div className="space-y-1.5">
							<label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
								Hourly Rate <span className="text-rose-500">*</span>
							</label>
							<input
								type="number"
								min={0}
								step="0.01"
								value={editingRateValue}
								onChange={(e) => onChangeRateValue(e.target.value)}
								required
								className={`w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 ${
									editingRateValue ? "border-slate-300" : "border-rose-300"
								}`}
							/>
						</div>
						<div className="space-y-1.5">
							<label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
								Currency <span className="text-rose-500">*</span>
							</label>
							<input
								type="text"
								maxLength={8}
								value={editingRateCurrency}
								onChange={(e) =>
									onChangeRateCurrency(e.target.value.toUpperCase())
								}
								required
								className={`w-full px-3 py-2.5 text-sm border rounded-lg uppercase focus:outline-none focus:ring-2 focus:ring-slate-300 ${
									editingRateCurrency ? "border-slate-300" : "border-rose-300"
								}`}
							/>
						</div>
						<div className="space-y-1.5">
							<label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
								Start Date <span className="text-rose-500">*</span>
							</label>
							<input
								type="date"
								value={editingRateStartDate}
								onChange={(e) => onChangeStartDate(e.target.value)}
								required
								className={`w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 ${
									editingRateStartDate ? "border-slate-300" : "border-rose-300"
								}`}
							/>
						</div>
						<div className="space-y-1.5">
							<label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
								End Date (Optional)
							</label>
							<input
								type="date"
								value={editingRateEndDate}
								onChange={(e) => onChangeEndDate(e.target.value)}
								className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
							/>
						</div>
					</div>
				</div>

				<div className="border-t border-slate-200 px-6 py-4 bg-slate-50">
					<div className="flex items-center justify-between gap-2">
						<button
							type="button"
							onClick={onRequestDelete}
							disabled={savingRate}
							className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
						>
							<Trash2 className="w-3.5 h-3.5" />
							Delete Rate
						</button>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={onClose}
								disabled={savingRate}
								className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50"
							>
								<XCircle className="w-3.5 h-3.5" />
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
								className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md border border-slate-700 bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
							>
								<Save className="w-3.5 h-3.5" />
								Save Changes
							</button>
						</div>
					</div>
				</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

// ───────────────────────── Delete Rate ─────────────────────────

interface DeleteRateModalProps {
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
	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-180 flex items-center justify-center bg-slate-900/55 backdrop-blur-[2px] p-4"
			onClick={onClose}
		>
			<div
				className="w-full max-w-md rounded-2xl border border-red-200 bg-white shadow-2xl overflow-hidden"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-red-100 px-5 py-4 bg-red-50">
					<div>
						<h3 className="text-base font-semibold text-red-800">
							Delete Team Rate
						</h3>
						<p className="text-xs text-red-700 mt-1">
							This action cannot be undone.
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-red-700 hover:bg-red-100"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				<div className="p-5 space-y-3">
					{targetLabel && (
						<p className="text-xs text-gray-600">
							You are deleting rate for{" "}
							<span className="font-semibold">{targetLabel}</span>.
						</p>
					)}
					<p className="text-xs text-gray-600">
						Type <span className="font-bold">DELETE</span> to confirm.
					</p>
					<input
						type="text"
						value={verificationText}
						onChange={(e) => onChangeVerificationText(e.target.value)}
						placeholder="Type DELETE"
						className="w-full px-3 py-2 text-sm border border-red-200 rounded-md bg-white"
					/>
				</div>

				<div className="flex items-center justify-end gap-2 border-t border-red-100 px-5 py-4 bg-red-50/40">
					<button
						type="button"
						onClick={onClose}
						disabled={deletingRate}
						className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50"
					>
						<XCircle className="w-3.5 h-3.5" />
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void onConfirmDelete()}
						disabled={
							deletingRate ||
							verificationText.trim().toUpperCase() !== "DELETE"
						}
						className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border border-red-300 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
					>
						<Trash2 className="w-3.5 h-3.5" />
						Confirm Delete
					</button>
				</div>
			</div>
		</div>
	);
}

// ───────────────────────── Delete Time Log ─────────────────────────

interface DeleteTimeLogModalProps {
	isOpen: boolean;
	deleting: boolean;
	taskLabel?: string;
	onClose: () => void;
	onConfirm: () => void | Promise<void>;
}

export function DeleteTimeLogModal({
	isOpen,
	deleting,
	taskLabel,
	onClose,
	onConfirm,
}: DeleteTimeLogModalProps) {
	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-175 flex items-center justify-center bg-slate-900/55 backdrop-blur-[2px] p-4"
			onClick={() => {
				if (deleting) return;
				onClose();
			}}
		>
			<div
				className="w-full max-w-md rounded-2xl border border-red-200 bg-white shadow-2xl overflow-hidden"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-red-100 px-5 py-4 bg-red-50">
					<div>
						<h3 className="text-base font-semibold text-red-800">
							Delete Time Log
						</h3>
						<p className="text-xs text-red-700 mt-1">
							This action permanently removes the selected log.
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						disabled={deleting}
						className="rounded-md p-1.5 text-red-700 hover:bg-red-100 disabled:opacity-50"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				<div className="px-5 py-4 text-sm text-gray-700">
					{taskLabel ? (
						<p>
							Delete this time log for{" "}
							<span className="font-semibold">{taskLabel}</span>?
						</p>
					) : (
						<p>Delete this time log?</p>
					)}
					{deleting && (
						<div className="mt-3 inline-flex items-center gap-2 rounded-md border border-red-100 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
							Deleting log, please wait...
						</div>
					)}
				</div>

				<div className="flex items-center justify-end gap-2 border-t border-red-100 px-5 py-4 bg-red-50/40">
					<button
						type="button"
						onClick={onClose}
						disabled={deleting}
						className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50"
					>
						<XCircle className="w-3.5 h-3.5" />
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void onConfirm()}
						disabled={deleting}
						className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border border-red-300 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
					>
						{deleting ? (
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
						) : (
							<Trash2 className="w-3.5 h-3.5" />
						)}
						{deleting ? "Deleting..." : "Delete Log"}
					</button>
				</div>
			</div>
		</div>
	);
}

// ───────────────────────── Add Log (Project → Epic → Feature → Task) ─────────────────────────

interface AddLogModalProps {
	isOpen: boolean;
	projects: TeamLogProject[];
	tasks: ProjectTaskOption[];
	loadingTasks: boolean;
	selectedProjectId: string;
	selectedTaskId: string;
	saving: boolean;
	title?: string;
	description?: string;
	saveLabel?: string;
	onClose: () => void;
	onSave: () => void | Promise<void>;
	onChangeProjectId: (value: string) => void;
	onChangeTaskId: (value: string) => void;
}

export function AddLogModal({
	isOpen,
	projects,
	tasks,
	loadingTasks,
	selectedProjectId,
	selectedTaskId,
	saving,
	title = "Start a timer",
	description = "Choose project, then epic, feature, and optional task.",
	saveLabel = "Start Timer",
	onClose,
	onSave,
	onChangeProjectId,
	onChangeTaskId,
}: AddLogModalProps) {
	const [selectedEpic, setSelectedEpic] = useState<string | null>(null);
	const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
	const [searchText, setSearchText] = useState("");
	const [debouncedSearchText, setDebouncedSearchText] = useState("");

	useEffect(() => {
		const timeout = window.setTimeout(() => {
			setDebouncedSearchText(searchText);
		}, 220);
		return () => window.clearTimeout(timeout);
	}, [searchText]);

	const normalizedSearch = debouncedSearchText.trim().toLowerCase();

	const epicGroups = useMemo(() => {
		const epicMap = new Map<
			string,
			{
				features: Map<string, { tasks: ProjectTaskOption[] }>;
			}
		>();

		for (const task of tasks) {
			const epicTitle = (task.epic_title || "Untitled epic").trim() || "Untitled epic";
			const featureTitle = (task.feature_title || "Untitled feature").trim() || "Untitled feature";

			if (!epicMap.has(epicTitle)) {
				epicMap.set(epicTitle, { features: new Map() });
			}
			const epicEntry = epicMap.get(epicTitle);
			if (!epicEntry) continue;

			if (!epicEntry.features.has(featureTitle)) {
				epicEntry.features.set(featureTitle, { tasks: [] });
			}
			const featureEntry = epicEntry.features.get(featureTitle);
			if (!featureEntry) continue;
			featureEntry.tasks.push(task);
		}

		return Array.from(epicMap.entries())
			.sort(([aTitle], [bTitle]) => aTitle.localeCompare(bTitle))
			.map(([epicTitle, epicEntry]) => ({
				epicTitle,
				features: Array.from(epicEntry.features.entries())
					.sort(([aTitle], [bTitle]) => aTitle.localeCompare(bTitle))
					.map(([featureTitle, featureEntry]) => ({
						featureTitle,
						tasks: [...featureEntry.tasks].sort((a, b) =>
							(a.title || "Untitled task").localeCompare(
								b.title || "Untitled task",
							),
						),
					})),
			}));
	}, [tasks]);

	const filteredEpics = useMemo(() => {
		if (!normalizedSearch) return epicGroups;
		return epicGroups.filter((epic) => {
			if (epic.epicTitle.toLowerCase().includes(normalizedSearch)) return true;
			return epic.features.some((feature) => {
				if (feature.featureTitle.toLowerCase().includes(normalizedSearch)) return true;
				return feature.tasks.some((task) =>
					(task.title || "Untitled task").toLowerCase().includes(normalizedSearch),
				);
			});
		});
	}, [epicGroups, normalizedSearch]);

	const selectedEpicEntry = useMemo(
		() => filteredEpics.find((epic) => epic.epicTitle === selectedEpic) ?? null,
		[filteredEpics, selectedEpic],
	);

	const filteredFeatures = useMemo(() => {
		if (!selectedEpicEntry) return [];
		if (!normalizedSearch) return selectedEpicEntry.features;
		return selectedEpicEntry.features.filter((feature) => {
			if (feature.featureTitle.toLowerCase().includes(normalizedSearch)) return true;
			return feature.tasks.some((task) =>
				(task.title || "Untitled task").toLowerCase().includes(normalizedSearch),
			);
		});
	}, [selectedEpicEntry, normalizedSearch]);

	const selectedFeatureEntry = useMemo(
		() => filteredFeatures.find((feature) => feature.featureTitle === selectedFeature) ?? null,
		[filteredFeatures, selectedFeature],
	);

	const filteredTasks = useMemo(() => {
		if (!selectedFeatureEntry) return [];
		if (!normalizedSearch) return selectedFeatureEntry.tasks;
		return selectedFeatureEntry.tasks.filter((task) =>
			(task.title || "Untitled task").toLowerCase().includes(normalizedSearch),
		);
	}, [selectedFeatureEntry, normalizedSearch]);

	useEffect(() => {
		if (!isOpen) return;

		const selectedTask = tasks.find((task) => task.id === selectedTaskId);
		if (selectedTask) {
			setSelectedEpic((selectedTask.epic_title || "Untitled epic").trim() || "Untitled epic");
			setSelectedFeature((selectedTask.feature_title || "Untitled feature").trim() || "Untitled feature");
			return;
		}

		const firstEpic = epicGroups[0]?.epicTitle ?? null;
		const firstFeature = epicGroups[0]?.features[0]?.featureTitle ?? null;
		setSelectedEpic(firstEpic);
		setSelectedFeature(firstFeature);
	}, [isOpen, tasks, selectedTaskId, epicGroups]);

	useEffect(() => {
		if (!selectedEpicEntry) {
			setSelectedFeature(null);
			return;
		}
		const featureExists = selectedEpicEntry.features.some(
			(feature) => feature.featureTitle === selectedFeature,
		);
		if (!featureExists) {
			setSelectedFeature(selectedEpicEntry.features[0]?.featureTitle ?? null);
		}
	}, [selectedEpicEntry, selectedFeature]);

	if (!isOpen) return null;

	return (
		<AnimatePresence>
			{isOpen && (
				<motion.div
					key="add-log-modal"
					className="fixed inset-0 z-168 flex items-center justify-center bg-slate-900/55 backdrop-blur-[2px] p-4"
					onClick={onClose}
					{...MODAL_BACKDROP_MOTION}
				>
					<motion.div
						className="w-full max-w-6xl max-h-[90vh] flex flex-col rounded-3xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(2,6,23,0.35)] overflow-hidden"
						onClick={(e) => e.stopPropagation()}
						{...MODAL_PANEL_MOTION}
					>
						<div className="flex items-center justify-between border-b border-slate-200 px-6 py-5 bg-linear-to-r from-slate-50 to-white">
							<div>
								<h3 className="text-lg font-semibold text-slate-900">{title}</h3>
								<p className="text-sm text-slate-500 mt-1">{description}</p>
							</div>
							<div className="flex items-center gap-4">
								<div className="relative">
									<Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
									<input
										type="text"
										value={searchText}
										onChange={(event) => setSearchText(event.target.value)}
										placeholder="Find epic, feature, or task..."
										className="w-64 bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300 transition-all placeholder:text-slate-400 text-slate-700 shadow-sm"
									/>
								</div>
								<button
									type="button"
									onClick={onClose}
									className="rounded-xl p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
								>
									<X className="w-5 h-5" />
								</button>
							</div>
						</div>

						<div className="flex-1 overflow-hidden p-6 bg-slate-50/50">
							<div className="grid grid-cols-1 md:grid-cols-4 gap-4 h-[55vh] min-h-[400px]">
								{/* Project Column */}
								<div className="flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
									<div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
										<Folder className="w-4 h-4 text-slate-400" />
										<span className="text-xs font-bold uppercase tracking-wider text-slate-600">Project</span>
									</div>
									<div className="flex-1 overflow-y-auto p-2 space-y-1 [scrollbar-width:thin] scrollbar-thumb-slate-200">
										{projects.length === 0 ? (
											<div className="p-4 text-center text-sm text-slate-500">No projects attached.</div>
										) : (
											projects.map((project) => (
												<button
													key={project.id}
													type="button"
													onClick={() => {
														onChangeProjectId(project.id);
														onChangeTaskId("");
														setSelectedEpic(null);
														setSelectedFeature(null);
													}}
													className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-sm transition-all group ${
														selectedProjectId === project.id
															? "bg-slate-100 text-slate-900 font-medium"
															: "text-slate-600 hover:bg-slate-50"
													}`}
												>
													<span className="truncate pr-2">{project.title || "(untitled)"}</span>
													{selectedProjectId === project.id ? (
														<CheckCircle2 className="w-4 h-4 text-slate-900 flex-shrink-0" />
													) : (
														<ChevronRight className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
													)}
												</button>
											))
										)}
									</div>
								</div>

								{/* Epic Column */}
								<div className="flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
									<div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
										<Layers className="w-4 h-4 text-slate-400" />
										<span className="text-xs font-bold uppercase tracking-wider text-slate-600">Epic</span>
									</div>
									<div className="flex-1 overflow-y-auto p-2 space-y-1 [scrollbar-width:thin] scrollbar-thumb-slate-200">
										{!selectedProjectId ? (
											<div className="p-4 text-center text-sm text-slate-500">Select a project first</div>
										) : loadingTasks ? (
											<div className="space-y-2 p-1">
												<div className="h-10 bg-slate-100 animate-pulse rounded-xl w-full"></div>
												<div className="h-10 bg-slate-100 animate-pulse rounded-xl w-full"></div>
												<div className="h-10 bg-slate-100 animate-pulse rounded-xl w-3/4"></div>
											</div>
										) : filteredEpics.length === 0 ? (
											<div className="p-4 text-center text-sm text-slate-500">No epics found.</div>
										) : (
											filteredEpics.map((epic) => (
												<button
													key={epic.epicTitle}
													type="button"
													onClick={() => {
														setSelectedEpic(epic.epicTitle);
														setSelectedFeature(epic.features[0]?.featureTitle ?? null);
														onChangeTaskId("");
													}}
													className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-sm transition-all group ${
														selectedEpic === epic.epicTitle
															? "bg-slate-100 text-slate-900 font-medium"
															: "text-slate-600 hover:bg-slate-50"
													}`}
												>
													<div className="flex flex-col truncate pr-2">
														<span className="truncate">{epic.epicTitle}</span>
														{selectedEpic !== epic.epicTitle && (
															<span className="text-[10px] text-slate-400 mt-0.5">{epic.features.length} feature{epic.features.length !== 1 ? 's' : ''}</span>
														)}
													</div>
													{selectedEpic === epic.epicTitle ? (
														<CheckCircle2 className="w-4 h-4 text-slate-900 flex-shrink-0" />
													) : (
														<ChevronRight className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
													)}
												</button>
											))
										)}
									</div>
								</div>

								{/* Feature Column */}
								<div className="flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
									<div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
										<Layout className="w-4 h-4 text-slate-400" />
										<span className="text-xs font-bold uppercase tracking-wider text-slate-600">Feature</span>
									</div>
									<div className="flex-1 overflow-y-auto p-2 space-y-1 [scrollbar-width:thin] scrollbar-thumb-slate-200">
										{!selectedProjectId ? (
											<div className="p-4 text-center text-sm text-slate-500">Select a project first</div>
										) : loadingTasks ? (
											<div className="space-y-2 p-1">
												<div className="h-10 bg-slate-100 animate-pulse rounded-xl w-full"></div>
												<div className="h-10 bg-slate-100 animate-pulse rounded-xl w-5/6"></div>
												<div className="h-10 bg-slate-100 animate-pulse rounded-xl w-4/6"></div>
											</div>
										) : filteredFeatures.length === 0 ? (
											<div className="p-4 text-center text-sm text-slate-500">
												{selectedEpic ? "No features found." : "Select an epic first"}
											</div>
										) : (
											filteredFeatures.map((feature) => (
												<button
													key={feature.featureTitle}
													type="button"
													onClick={() => {
														setSelectedFeature(feature.featureTitle);
														onChangeTaskId("");
													}}
													className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-sm transition-all group ${
														selectedFeature === feature.featureTitle
															? "bg-slate-100 text-slate-900 font-medium"
															: "text-slate-600 hover:bg-slate-50"
													}`}
												>
													<div className="flex flex-col truncate pr-2">
														<span className="truncate">{feature.featureTitle}</span>
														{selectedFeature !== feature.featureTitle && (
															<span className="text-[10px] text-slate-400 mt-0.5">{feature.tasks.length} task{feature.tasks.length !== 1 ? 's' : ''}</span>
														)}
													</div>
													{selectedFeature === feature.featureTitle ? (
														<CheckCircle2 className="w-4 h-4 text-slate-900 flex-shrink-0" />
													) : (
														<ChevronRight className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
													)}
												</button>
											))
										)}
									</div>
								</div>

								{/* Task Column */}
								<div className="flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative">
									<div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/80">
										<div className="flex items-center gap-2">
											<CheckCircle2 className="w-4 h-4 text-slate-400" />
											<span className="text-xs font-bold uppercase tracking-wider text-slate-600">Task</span>
										</div>
										<span className="text-[10px] uppercase font-bold tracking-wider bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded">Optional</span>
									</div>
									<div className="flex-1 overflow-y-auto p-2 space-y-1 [scrollbar-width:thin] scrollbar-thumb-slate-200 relative">
										{!selectedProjectId ? (
											<div className="p-4 text-center text-sm text-slate-500">Select a project first</div>
										) : loadingTasks ? (
											<div className="space-y-2 p-1">
												<div className="h-10 bg-slate-800 animate-pulse rounded-xl w-full"></div>
												<div className="h-px bg-slate-100 w-full my-2"></div>
												<div className="h-10 bg-slate-100 animate-pulse rounded-xl w-full"></div>
												<div className="h-10 bg-slate-100 animate-pulse rounded-xl w-5/6"></div>
												<div className="h-10 bg-slate-100 animate-pulse rounded-xl w-4/6"></div>
											</div>
										) : (
											<>
												<button
													type="button"
													onClick={() => onChangeTaskId("")}
													className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-sm transition-all mb-2 ${
														!selectedTaskId
															? "bg-slate-800 text-white font-medium shadow-md"
															: "bg-slate-100 text-slate-600 hover:bg-slate-200"
													}`}
												>
													<span>General Time / No Task</span>
													{!selectedTaskId && <CheckCircle2 className="w-4 h-4 text-white flex-shrink-0" />}
												</button>
												
												<div className="h-px bg-slate-100 w-full my-2"></div>
												
												{filteredTasks.length === 0 ? (
													<div className="p-4 text-center text-sm text-slate-500">No tasks found.</div>
												) : (
													filteredTasks.map((task) => (
														<button
															key={task.id}
															type="button"
															onClick={() => onChangeTaskId(task.id)}
															className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-sm transition-all border ${
																selectedTaskId === task.id
																	? "bg-slate-100 border-slate-300 text-slate-900 font-medium shadow-sm"
																	: "bg-white border-slate-100 text-slate-700 hover:border-slate-300 hover:shadow-sm"
															}`}
														>
															<span className="truncate pr-2">{task.title || "Untitled task"}</span>
															{selectedTaskId === task.id && (
																<CheckCircle2 className="w-4 h-4 text-slate-900 flex-shrink-0" />
															)}
														</button>
													))
												)}
											</>
										)}
									</div>
								</div>
							</div>
						</div>

						<div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-5 bg-white">
							<button
								type="button"
								onClick={onClose}
								disabled={saving}
								className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all disabled:opacity-50"
							>
								<XCircle className="w-4 h-4" />
								Cancel
							</button>
							<button
								type="button"
								onClick={() => void onSave()}
								disabled={saving || !selectedProjectId}
								className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-xl border border-transparent bg-slate-900 text-white hover:bg-slate-800 shadow-sm shadow-slate-900/20 transition-all disabled:opacity-50 disabled:shadow-none"
							>
								{saving ? (
									<Loader2 className="w-4 h-4 animate-spin" />
								) : (
									<Play className="w-4 h-4" fill="currentColor" />
								)}
								{saveLabel}
							</button>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
