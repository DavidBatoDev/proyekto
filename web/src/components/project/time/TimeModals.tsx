import { ChevronDown, Loader2, Save, Search, Trash2, X, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ProjectMemberTimeRate,
  ProjectTaskOption,
} from "@/services/project-time.service";
import type { ProjectMember } from "@/services/project.service";

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
            <p className="text-xs text-gray-500 mt-1">Update time-in and time-out.</p>
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

interface AddRateModalProps {
  isOpen: boolean;
  canManageRates: boolean;
  membersWithoutRate: ProjectMember[];
  loadingMembers: boolean;
  savingRate: boolean;
  newRateMemberId: string;
  newRateCustomId: string;
  newRateValue: string;
  newRateCurrency: string;
  newRateStartDate: string;
  newRateEndDate: string;
  onClose: () => void;
  onCreateRate: () => void | Promise<void>;
  onChangeMemberId: (value: string) => void;
  onChangeCustomId: (value: string) => void;
  onChangeRateValue: (value: string) => void;
  onChangeRateCurrency: (value: string) => void;
  onChangeStartDate: (value: string) => void;
  onChangeEndDate: (value: string) => void;
  formatMemberRole: (member: ProjectMember) => string;
}

export function AddRateModal({
  isOpen,
  canManageRates,
  membersWithoutRate,
  loadingMembers,
  savingRate,
  newRateMemberId,
  newRateCustomId,
  newRateValue,
  newRateCurrency,
  newRateStartDate,
  newRateEndDate,
  onClose,
  onCreateRate,
  onChangeMemberId,
  onChangeCustomId,
  onChangeRateValue,
  onChangeRateCurrency,
  onChangeStartDate,
  onChangeEndDate,
  formatMemberRole,
}: AddRateModalProps) {
  if (!isOpen || !canManageRates) return null;

  return (
    <div
      className="fixed inset-0 z-160 flex items-center justify-center bg-slate-900/55 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(2,6,23,0.35)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5 bg-linear-to-r from-slate-50 to-white">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Add Team Rate</h3>
            <p className="text-xs text-slate-500 mt-1">
              Enable time tracking for a project member by assigning hourly rate.
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

        <div className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Select Member
            </label>
            <select
              value={newRateMemberId}
              onChange={(e) => onChangeMemberId(e.target.value)}
              disabled={savingRate || loadingMembers}
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="">Select member</option>
              {membersWithoutRate.map((member) => {
                const memberName =
                  member.user?.display_name ||
                  member.user?.email ||
                  member.user_id ||
                  member.id;
                return (
                  <option key={member.id} value={member.id}>
                    {memberName} ({formatMemberRole(member)})
                  </option>
                );
              })}
            </select>
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
                Hourly Rate
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={newRateValue}
                onChange={(e) => onChangeRateValue(e.target.value)}
                placeholder="e.g. 25.00"
                disabled={savingRate}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Currency
              </label>
              <input
                type="text"
                value={newRateCurrency}
                onChange={(e) => onChangeRateCurrency(e.target.value)}
                placeholder="USD"
                maxLength={8}
                disabled={savingRate}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg uppercase focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Start Date
              </label>
              <input
                type="date"
                value={newRateStartDate}
                onChange={(e) => onChangeStartDate(e.target.value)}
                disabled={savingRate}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
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
            Members with no rate row cannot use the Time page or timer actions.
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
            disabled={savingRate || loadingMembers}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md border border-slate-700 bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            Save Rate
          </button>
        </div>
      </div>
    </div>
  );
}

interface EditRateModalProps {
  isOpen: boolean;
  canManageRates: boolean;
  editingRateId: string | null;
  editingRateTarget: ProjectMemberTimeRate | null;
  editingRateCustomId: string;
  editingRateValue: string;
  editingRateCurrency: string;
  editingRateStartDate: string;
  editingRateEndDate: string;
  savingRate: boolean;
  onClose: () => void;
  onSave: (rateId: string) => void | Promise<void>;
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
  editingRateId,
  editingRateTarget,
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
  if (!isOpen || !canManageRates || !editingRateId) return null;

  const memberName =
    editingRateTarget?.member?.display_name ||
    editingRateTarget?.member?.email ||
    editingRateTarget?.member_user_id ||
    "Unknown member";

  return (
    <div
      className="fixed inset-0 z-170 flex items-center justify-center bg-slate-900/55 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(2,6,23,0.35)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5 bg-linear-to-r from-slate-50 to-white">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Edit Team Rate</h3>
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

        <div className="p-6 space-y-4">
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
                Hourly Rate
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={editingRateValue}
                onChange={(e) => onChangeRateValue(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Currency
              </label>
              <input
                type="text"
                maxLength={8}
                value={editingRateCurrency}
                onChange={(e) => onChangeRateCurrency(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg uppercase focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Start Date
              </label>
              <input
                type="date"
                value={editingRateStartDate}
                onChange={(e) => onChangeStartDate(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
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
                onClick={() => void onSave(editingRateId)}
                disabled={savingRate}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md border border-slate-700 bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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
            <h3 className="text-base font-semibold text-red-800">Delete Team Rate</h3>
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
              You are deleting rate for <span className="font-semibold">{targetLabel}</span>.
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
            disabled={deletingRate || verificationText.trim().toUpperCase() !== "DELETE"}
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
            <h3 className="text-base font-semibold text-red-800">Delete Time Log</h3>
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
              Delete this time log for <span className="font-semibold">{taskLabel}</span>?
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

interface AddLogModalProps {
  isOpen: boolean;
  tasks: ProjectTaskOption[];
  selectedTaskId: string;
  saving: boolean;
  title?: string;
  description?: string;
  saveLabel?: string;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  onChangeTaskId: (value: string) => void;
}

export function AddLogModal({
  isOpen,
  tasks,
  selectedTaskId,
  saving,
  title = "Add Time Log",
  description = "Choose a task to start logging time.",
  saveLabel = "Add Log",
  onClose,
  onSave,
  onChangeTaskId,
}: AddLogModalProps) {
  const [selectedEpic, setSelectedEpic] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [showFind, setShowFind] = useState(false);
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
        epicPosition?: number;
        features: Map<
          string,
          {
            featurePosition?: number;
            tasks: ProjectTaskOption[];
          }
        >;
      }
    >();

    for (const task of tasks) {
      const epicTitle = (task.epic_title || "Untitled epic").trim() || "Untitled epic";
      const featureTitle =
        (task.feature_title || "Untitled feature").trim() || "Untitled feature";

      if (!epicMap.has(epicTitle)) {
        epicMap.set(epicTitle, {
          epicPosition: task.epic_position,
          features: new Map(),
        });
      }

      const epicEntry = epicMap.get(epicTitle);
      if (!epicEntry) continue;
      if (epicEntry.epicPosition === undefined && task.epic_position !== undefined) {
        epicEntry.epicPosition = task.epic_position;
      }

      if (!epicEntry.features.has(featureTitle)) {
        epicEntry.features.set(featureTitle, {
          featurePosition: task.feature_position,
          tasks: [],
        });
      }

      const featureEntry = epicEntry.features.get(featureTitle);
      if (!featureEntry) continue;
      if (
        featureEntry.featurePosition === undefined &&
        task.feature_position !== undefined
      ) {
        featureEntry.featurePosition = task.feature_position;
      }
      featureEntry.tasks.push(task);
    }

    return Array.from(epicMap.entries())
      .sort(([aTitle, aEntry], [bTitle, bEntry]) => {
        const aPos = aEntry.epicPosition ?? Number.MAX_SAFE_INTEGER;
        const bPos = bEntry.epicPosition ?? Number.MAX_SAFE_INTEGER;
        if (aPos !== bPos) return aPos - bPos;
        return aTitle.localeCompare(bTitle);
      })
      .map(([epicTitle, epicEntry]) => ({
        epicTitle,
        features: Array.from(epicEntry.features.entries())
          .sort(([aTitle, aEntry], [bTitle, bEntry]) => {
            const aPos = aEntry.featurePosition ?? Number.MAX_SAFE_INTEGER;
            const bPos = bEntry.featurePosition ?? Number.MAX_SAFE_INTEGER;
            if (aPos !== bPos) return aPos - bPos;
            return aTitle.localeCompare(bTitle);
          })
          .map(([featureTitle, featureEntry]) => ({
            featureTitle,
            tasks: [...featureEntry.tasks].sort((a, b) =>
              (a.title || "Untitled task").localeCompare(b.title || "Untitled task"),
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
      setSelectedFeature(
        (selectedTask.feature_title || "Untitled feature").trim() || "Untitled feature",
      );
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

  useEffect(() => {
    if (!normalizedSearch) return;

    for (const epic of epicGroups) {
      for (const feature of epic.features) {
        for (const task of feature.tasks) {
          const taskLabel = (task.title || "Untitled task").trim().toLowerCase();
          if (taskLabel === normalizedSearch) {
            setSelectedEpic(epic.epicTitle);
            setSelectedFeature(feature.featureTitle);
            if (selectedTaskId !== task.id) onChangeTaskId(task.id);
            return;
          }
        }
      }
    }

    for (const epic of epicGroups) {
      for (const feature of epic.features) {
        if (feature.featureTitle.trim().toLowerCase() === normalizedSearch) {
          setSelectedEpic(epic.epicTitle);
          setSelectedFeature(feature.featureTitle);
          return;
        }
      }
    }

    const epicExact = epicGroups.find(
      (epic) => epic.epicTitle.trim().toLowerCase() === normalizedSearch,
    );
    if (epicExact) {
      setSelectedEpic(epicExact.epicTitle);
      setSelectedFeature(epicExact.features[0]?.featureTitle ?? null);
    }
  }, [normalizedSearch, epicGroups, selectedTaskId, onChangeTaskId]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-168 flex items-center justify-center bg-slate-900/55 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <p className="text-xs text-gray-500 mt-1">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">Choose Epic, then Feature, then Task.</p>
            <button
              type="button"
              onClick={() => {
                setShowFind((prev) => !prev);
                if (showFind) setSearchText("");
              }}
              className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 transition-colors duration-200"
            >
              <Search className="h-3.5 w-3.5" />
              Find
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showFind ? "rotate-180" : ""}`}
              />
            </button>
          </div>

          <div
            className={`overflow-hidden transition-all duration-300 ease-out ${
              showFind ? "max-h-16 opacity-100 translate-y-0" : "max-h-0 opacity-0 -translate-y-1 pointer-events-none"
            }`}
          >
            <div className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2">
              <Search className="h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Find epic, feature, or task"
                className="w-full border-0 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-md border border-gray-200">
              <div className="border-b border-gray-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Epic
              </div>
              <div className="max-h-52 overflow-auto p-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {filteredEpics.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-gray-500">No epics found.</p>
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
                      className={`block w-full rounded px-2 py-1.5 text-left text-sm transition-colors duration-200 ${
                        selectedEpic === epic.epicTitle
                          ? "bg-slate-100 text-slate-700"
                          : "text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {epic.epicTitle}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-md border border-gray-200">
              <div className="border-b border-gray-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Feature
              </div>
              <div className="max-h-52 overflow-auto p-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {filteredFeatures.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-gray-500">No features found.</p>
                ) : (
                  filteredFeatures.map((feature) => (
                    <button
                      key={feature.featureTitle}
                      type="button"
                      onClick={() => {
                        setSelectedFeature(feature.featureTitle);
                        onChangeTaskId("");
                      }}
                      className={`block w-full rounded px-2 py-1.5 text-left text-sm transition-colors duration-200 ${
                        selectedFeature === feature.featureTitle
                          ? "bg-slate-100 text-slate-700"
                          : "text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {feature.featureTitle}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-md border border-gray-200">
              <div className="border-b border-gray-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Task
              </div>
              <div className="max-h-52 overflow-auto p-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {filteredTasks.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-gray-500">No tasks found.</p>
                ) : (
                  filteredTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onChangeTaskId(task.id)}
                      className={`block w-full rounded px-2 py-1.5 text-left text-sm transition-colors duration-200 ${
                        selectedTaskId === task.id
                          ? "bg-slate-100 text-slate-700"
                          : "text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {task.title || "Untitled task"}
                    </button>
                  ))
                )}
              </div>
            </div>
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
            disabled={saving || !selectedTaskId}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border border-slate-700 bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

