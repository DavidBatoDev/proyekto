import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Info, Loader2 } from "lucide-react";
import {
	type FormEvent,
	type InputHTMLAttributes,
	type ReactNode,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	featureLimitInfo,
	PlanLimitNotice,
} from "@/components/billing/PlanLimitNotice";
import {
	appliesFromCopy,
	nextPeriodStart,
	PERIOD_KINDS,
	ROUNDING_OPTIONS,
	retroSummary,
} from "@/components/team/settings/time/TeamRulesSection";
import { SettingSwitch } from "@/components/team-time/SettingSwitch";
import { workItemLabel } from "@/components/time/entries/entryRules";
import {
	SettingsNotice,
	SettingsRow,
	SettingsRows,
	SettingsSection,
	settingsButton,
	settingsInput,
} from "@/components/workspace/settings/SettingsPrimitives";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useToast } from "@/hooks/useToast";
import { listTimeZones } from "@/lib/datetime";
import type { WorkspaceEntitlements } from "@/lib/entitlements";
import type { PlanLimitInfo } from "@/lib/planLimitErrors";
import { limitDefinition } from "@/lib/planLimits";
import { isNativeApp } from "@/lib/platform";
import { timeErrorMessage, timePlanCopy } from "@/lib/timeErrors";
import {
	formatLocalDay,
	formatMinutesText,
	periodKindTitle,
	weekdayName,
} from "@/lib/timeFormat";
import { addDays, isLocalDate, isoDow } from "@/lib/timePeriods";
import { featureNoteCopy } from "@/lib/usageCopy";
import { cn } from "@/lib/utils";
import { invalidateTime, timeKeys } from "@/queries/time";
import { isTimeApiError, timeService } from "@/services/time.service";
import {
	type PeriodKind,
	PRESET_WORK_ITEMS,
	type PresetWorkItem,
	type ResolvedTimePolicy,
	type WorkspacePolicyView,
	type WorkspaceTimePolicyInput,
} from "@/services/time.types";
import type { Workspace } from "@/services/workspaces.service";

/**
 * Workspace settings › Time › Policy (ux.md › Settings › Workspace Time
 * Policy): how a workspace tracks, groups and approves time.
 *
 * - Owners and admins edit (`can_edit`); members read the same values (A4).
 * - Free (`plan.time_tracking: false`): every control but the timezone and
 *   the week start sits behind the `time_tracking` plan notice, which keeps
 *   "Everyone can still track time just for themselves."
 * - A new period, timezone or week start applies from the next period start:
 *   "Applies from Mon Oct 12. Open timesheets keep their dates." (L40)
 * - "Detected from your browser" shows only while the policy has never been
 *   saved by a person (`policy_unconfirmed`) and the timezone is the editor's
 *   own (CHANGE-11). Any save confirms the policy, so an unconfirmed policy
 *   can be saved as it stands.
 * - Saves send only the fields that changed (the backend plan-gates by field).
 */

// ── Copy ────────────────────────────────────────────────────────────────────

export const POLICY_FORM_COPY = {
	formLabel: "Time policy",
	sectionTimesheets: "Timesheets",
	sectionApproval: "Approval",
	sectionAdding: "Adding time",
	tracking: "Time on workspace projects",
	on: "On",
	off: "Off",
	period: "Timesheet period",
	weekStartsOn: "Week starts on",
	timezone: "Timezone",
	timezoneHint: "Days and periods are counted in this timezone",
	detectedBrowser: "Detected from your browser",
	detectedDevice: "Detected from this device",
	approval: "Approval",
	required: "Required",
	notRequired: "Not required",
	approvers: "Approvers: workspace owners and admins",
	manual: "Manual time",
	allowed: "Allowed",
	manualUpTo: "up to",
	manualDaysBack: "days back (0 = no limit)",
	manualWindow: "Days back people can add time (0 = no limit)",
	rounding: "Rounding",
	roundingHint: "5, 6, 10, 15 or 30 min · nearest, ties round up",
	none: "None",
	reminder: "Reminder",
	reminderBefore: "Remind people to submit",
	reminderAfter: "day(s) after a period ends (1–14)",
	weeklyLimit: "Weekly limit",
	weeklyLimitUnit: "hours",
	weeklyLimitHint:
		"Leave empty for no limit. People see a warning past it; it never blocks or cuts time.",
	presets: "Presets",
	presetsHint: "Offered under “Not on a task” when people add time.",
	readOnly: "Only workspace owners and admins can change the time policy.",
	unconfirmed:
		"Nobody has confirmed these settings yet. Save to keep them, or change them first.",
	save: "Save",
	cancel: "Cancel",
	saved: "Time policy saved",
} as const;

/** "People on Acme projects who aren't on a team log for "Acme"" (tracking on). */
export function trackingDescription(
	workspaceName: string,
	trackingOn: boolean,
): string {
	const name = workspaceName.trim() || "this workspace";
	return trackingOn
		? `People on ${name} projects who aren't on a team log for “${name}”.`
		: "People who aren't on a team can only track time for themselves.";
}

/** "1 day after a period ends", "3 days after a period ends". */
export function reminderSummary(days: number): string {
	const n = Math.max(0, Math.trunc(days));
	return `${n} ${n === 1 ? "day" : "days"} after a period ends`;
}

/** "Allowed · up to 7 days back", "Allowed · no limit", "Off". */
export function manualSummaryLine(
	allowed: boolean,
	days: number | null | undefined,
): string {
	if (!allowed) return POLICY_FORM_COPY.off;
	return `${POLICY_FORM_COPY.allowed} · ${retroSummary(days)}`;
}

/** "None", "15 min · nearest, ties round up". */
export function roundingValueLine(minutes: number | null | undefined): string {
	return typeof minutes === "number" && minutes > 0
		? `${minutes} min · nearest, ties round up`
		: POLICY_FORM_COPY.none;
}

/** "Meeting, Review, Admin, Other"; "None" when every preset is hidden. */
export function presetsLine(shown: readonly PresetWorkItem[]): string {
	return shown.length > 0
		? shown.map((item) => workItemLabel(item)).join(", ")
		: POLICY_FORM_COPY.none;
}

// ── Draft model ─────────────────────────────────────────────────────────────

/** The editable values, as the form holds them. */
export interface PolicyDraft {
	tracking_enabled: boolean;
	period_kind: PeriodKind;
	week_start: number;
	timezone: string;
	approval_required: boolean;
	allow_manual_entries: boolean;
	/** 0 = no limit (the API also reads null as no limit). */
	retroactive_days: number;
	rounding_minutes: number;
	/** Null = no limit. */
	weekly_limit_minutes: number | null;
	reminder_days: number;
	/** The presets people are offered (the inverse of `hidden_presets`). */
	shown_presets: PresetWorkItem[];
}

/** Fields a Free workspace may still change (backend WORKSPACE_PLAN_FREE_FIELDS). */
export const PLAN_FREE_FIELDS: ReadonlySet<keyof WorkspaceTimePolicyInput> =
	new Set(["timezone", "week_start"]);

export const REMINDER_MIN = 1;
export const REMINDER_MAX = 14;
export const RETRO_MAX = 3650;
export const WEEKLY_LIMIT_MAX_HOURS = 168;

function positiveOrNull(value: number | null | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.trunc(value)
		: null;
}

export function draftFromPolicy(policy: ResolvedTimePolicy): PolicyDraft {
	const hidden = new Set(
		Array.isArray(policy.hidden_presets) ? policy.hidden_presets : [],
	);
	return {
		tracking_enabled: Boolean(policy.tracking_enabled),
		period_kind: policy.period_kind,
		week_start: policy.week_start,
		timezone: policy.timezone,
		approval_required: Boolean(policy.approval_required),
		allow_manual_entries: Boolean(policy.allow_manual_entries),
		retroactive_days: positiveOrNull(policy.retroactive_days) ?? 0,
		rounding_minutes: Number(policy.rounding_minutes ?? 0) || 0,
		weekly_limit_minutes: positiveOrNull(policy.weekly_limit_minutes),
		reminder_days: Math.trunc(Number(policy.reminder_days ?? 1)),
		shown_presets: PRESET_WORK_ITEMS.filter((item) => !hidden.has(item)),
	};
}

function hiddenPresetsOf(shown: readonly PresetWorkItem[]): PresetWorkItem[] {
	const keep = new Set(shown);
	return PRESET_WORK_ITEMS.filter((item) => !keep.has(item));
}

/**
 * A biweekly anchor must fall on the week start (`trg_time_policies_guard`),
 * so a new week start moves a stored anchor to that weekday in the same week.
 */
export function shiftAnchor(anchor: string, weekStart: number): string {
	if (!isLocalDate(anchor)) return anchor;
	const delta = (((weekStart - isoDow(anchor)) % 7) + 7) % 7;
	return addDays(anchor, delta);
}

/**
 * The PUT body: only the fields whose value differs from the stored policy.
 * Without the plan, only the plan-free fields are sent (the rest are locked
 * in the form anyway).
 */
export function policyPatch(
	draft: PolicyDraft,
	policy: ResolvedTimePolicy,
	options: { planOk: boolean },
): WorkspaceTimePolicyInput {
	const base = draftFromPolicy(policy);
	const patch: WorkspaceTimePolicyInput = {};
	if (draft.tracking_enabled !== base.tracking_enabled) {
		patch.tracking_enabled = draft.tracking_enabled;
	}
	if (draft.period_kind !== base.period_kind) {
		patch.period_kind = draft.period_kind;
	}
	if (draft.week_start !== base.week_start) {
		patch.week_start = draft.week_start;
		if (policy.period_anchor && options.planOk) {
			const moved = shiftAnchor(policy.period_anchor, draft.week_start);
			if (moved !== policy.period_anchor) patch.period_anchor = moved;
		}
	}
	if (draft.timezone !== base.timezone) patch.timezone = draft.timezone;
	if (draft.approval_required !== base.approval_required) {
		patch.approval_required = draft.approval_required;
	}
	if (draft.allow_manual_entries !== base.allow_manual_entries) {
		patch.allow_manual_entries = draft.allow_manual_entries;
	}
	if (draft.retroactive_days !== base.retroactive_days) {
		patch.retroactive_days =
			draft.retroactive_days > 0 ? draft.retroactive_days : null;
	}
	if (draft.rounding_minutes !== base.rounding_minutes) {
		patch.rounding_minutes = draft.rounding_minutes;
	}
	if (draft.weekly_limit_minutes !== base.weekly_limit_minutes) {
		patch.weekly_limit_minutes = draft.weekly_limit_minutes;
	}
	if (draft.reminder_days !== base.reminder_days) {
		patch.reminder_days = draft.reminder_days;
	}
	const hidden = hiddenPresetsOf(draft.shown_presets);
	const baseHidden = hiddenPresetsOf(base.shown_presets);
	if (hidden.join(",") !== baseHidden.join(",")) {
		patch.hidden_presets = hidden;
	}
	if (options.planOk) return patch;
	const free: WorkspaceTimePolicyInput = {};
	for (const key of Object.keys(patch) as (keyof WorkspaceTimePolicyInput)[]) {
		if (PLAN_FREE_FIELDS.has(key)) {
			(free as Record<string, unknown>)[key] = patch[key];
		}
	}
	return free;
}

function usesWeekStart(kind: PeriodKind): boolean {
	return kind === "weekly" || kind === "biweekly";
}

/** True when the draft moves period boundaries (L40: "Applies from …"). */
export function periodChanged(
	draft: PolicyDraft,
	policy: ResolvedTimePolicy,
): boolean {
	return (
		draft.period_kind !== policy.period_kind ||
		draft.timezone !== policy.timezone ||
		(draft.week_start !== policy.week_start &&
			(usesWeekStart(draft.period_kind) || usesWeekStart(policy.period_kind)))
	);
}

/** "Applies from Mon Oct 12. Open timesheets keep their dates."; null when unknown. */
export function appliesFromLine(
	policy: ResolvedTimePolicy,
	now: Date = new Date(),
): string | null {
	const next = nextPeriodStart(policy, now);
	return next
		? appliesFromCopy(formatLocalDay(next, { weekday: true, now }))
		: null;
}

/**
 * The plan notice for a workspace without timesheets. The server's
 * `plan.time_tracking` decides; usage only shapes the notice, and a built
 * Pro notice stands in while it is unknown.
 */
export function trackingPlanInfo(
	entitlements: WorkspaceEntitlements,
	planOk: boolean,
): PlanLimitInfo | null {
	if (planOk) return null;
	return (
		featureLimitInfo(entitlements, "time_tracking") ?? {
			limitKey: "time_tracking",
			kind: "feature",
			label:
				limitDefinition("time_tracking")?.label ?? "Timesheets and approvals",
			limit: null,
			used: null,
			plan: entitlements.plan ?? "free",
			upgradePlan: "pro",
			workspaceId: entitlements.usage?.workspace_id ?? null,
			workspaceSlug: null,
			context: "enable",
			message: "",
		}
	);
}

/** "Detected from …" shows only on a policy nobody has saved, set to the editor's own zone. */
export function showsDetectedTimezone(
	view: Pick<WorkspacePolicyView, "policy_unconfirmed" | "can_edit">,
	timezone: string,
	browserTz: string | null | undefined,
): boolean {
	return Boolean(
		view.can_edit &&
			view.policy_unconfirmed &&
			browserTz &&
			timezone === browserTz,
	);
}

// ── Controls ────────────────────────────────────────────────────────────────

const selectClass = cn(settingsInput, "w-auto max-w-full py-1.5");
const numberClass = cn(settingsInput, "w-20 py-1.5 tabular-nums");
const radioClass = "h-4 w-4 shrink-0 accent-primary";
const checkboxClass = "h-4 w-4 shrink-0 rounded accent-primary";

function Toggle({
	checked,
	onChange,
	label,
	on,
	off,
	disabled,
}: {
	checked: boolean;
	onChange: (next: boolean) => void;
	label: string;
	on: string;
	off: string;
	disabled?: boolean;
}) {
	return (
		<span className="inline-flex items-center gap-3">
			<SettingSwitch
				checked={checked}
				onChange={onChange}
				label={label}
				disabled={disabled}
			/>
			<span
				className={cn(
					"min-w-[5.5rem] text-left text-sm",
					disabled ? "text-muted-foreground" : "text-foreground",
				)}
				aria-hidden="true"
			>
				{checked ? on : off}
			</span>
		</span>
	);
}

/**
 * A whole number in [min, max]; `empty` for a cleared field; undefined while
 * the text is not (yet) a valid value, so a half-typed number never jumps.
 */
export function parseWholeNumber(
	raw: string,
	min: number,
	max: number,
	empty: number | undefined,
): number | undefined {
	const text = raw.trim();
	if (text === "") return empty;
	const n = Number(text);
	if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
		return undefined;
	}
	return n;
}

/** Hours typed for the weekly limit → minutes; null when cleared; undefined while invalid. */
export function parseWeeklyLimitHours(raw: string): number | null | undefined {
	const text = raw.trim();
	if (text === "") return null;
	const hours = Number(text);
	if (!Number.isFinite(hours) || hours <= 0 || hours > WEEKLY_LIMIT_MAX_HOURS) {
		return undefined;
	}
	return Math.max(1, Math.round(hours * 60));
}

/** Hours shown for a minute value: "40", "37.5"; "" for none. */
export function hoursOf(minutes: number | null): string {
	if (minutes === null) return "";
	return String(Math.round((minutes / 60) * 100) / 100);
}

/**
 * A number input that keeps what the person types and reports only valid
 * values; on blur it shows the value in force again.
 */
function NumberField({
	value,
	format,
	parse,
	onValue,
	className,
	...input
}: {
	value: number | null;
	format: (value: number | null) => string;
	parse: (raw: string) => number | null | undefined;
	onValue: (value: number | null) => void;
	className?: string;
} & Omit<
	InputHTMLAttributes<HTMLInputElement>,
	"value" | "onChange" | "type" | "className"
>) {
	const [text, setText] = useState(() => format(value));
	const [synced, setSynced] = useState(value);
	if (value !== synced) {
		setSynced(value);
		setText(format(value));
	}
	return (
		<input
			{...input}
			type="number"
			value={text}
			onChange={(event) => {
				const raw = event.target.value;
				setText(raw);
				const next = parse(raw);
				if (next !== undefined && next !== value) {
					setSynced(next);
					onValue(next);
				}
			}}
			onBlur={(event) => {
				setText(format(value));
				input.onBlur?.(event);
			}}
			className={className}
		/>
	);
}

// ── Read-only view (members, A4) ────────────────────────────────────────────

function ReadOnlyPolicy({
	workspaceName,
	policy,
	planOk,
}: {
	workspaceName: string;
	policy: ResolvedTimePolicy;
	planOk: boolean;
}) {
	const draft = draftFromPolicy(policy);
	const trackingOn = draft.tracking_enabled && planOk;
	return (
		<div data-testid="time-policy-readonly">
			<div className="pt-6">
				<SettingsNotice tone="info" icon={Info}>
					{POLICY_FORM_COPY.readOnly}
				</SettingsNotice>
			</div>
			<SettingsSection
				id="time-policy-timesheets"
				title={POLICY_FORM_COPY.sectionTimesheets}
			>
				<SettingsRows>
					<SettingsRow
						inline
						label={POLICY_FORM_COPY.tracking}
						description={trackingDescription(workspaceName, trackingOn)}
					>
						{trackingOn ? POLICY_FORM_COPY.on : POLICY_FORM_COPY.off}
					</SettingsRow>
					<SettingsRow inline label={POLICY_FORM_COPY.period}>
						{periodKindTitle(draft.period_kind)}
					</SettingsRow>
					<SettingsRow inline label={POLICY_FORM_COPY.weekStartsOn}>
						{weekdayName(draft.week_start)}
					</SettingsRow>
					<SettingsRow
						inline
						label={POLICY_FORM_COPY.timezone}
						description={POLICY_FORM_COPY.timezoneHint}
					>
						<span className="break-all">{draft.timezone}</span>
					</SettingsRow>
					<SettingsRow inline label={POLICY_FORM_COPY.reminder}>
						{reminderSummary(draft.reminder_days)}
					</SettingsRow>
				</SettingsRows>
			</SettingsSection>
			<SettingsSection
				id="time-policy-approval"
				title={POLICY_FORM_COPY.sectionApproval}
			>
				<SettingsRows>
					<SettingsRow
						inline
						label={POLICY_FORM_COPY.approval}
						description={POLICY_FORM_COPY.approvers}
					>
						{draft.approval_required
							? POLICY_FORM_COPY.required
							: POLICY_FORM_COPY.notRequired}
					</SettingsRow>
				</SettingsRows>
			</SettingsSection>
			<SettingsSection
				id="time-policy-adding"
				title={POLICY_FORM_COPY.sectionAdding}
			>
				<SettingsRows>
					<SettingsRow inline label={POLICY_FORM_COPY.manual}>
						{manualSummaryLine(
							draft.allow_manual_entries,
							draft.retroactive_days,
						)}
					</SettingsRow>
					<SettingsRow inline label={POLICY_FORM_COPY.rounding}>
						{roundingValueLine(draft.rounding_minutes)}
					</SettingsRow>
					<SettingsRow inline label={POLICY_FORM_COPY.weeklyLimit}>
						{draft.weekly_limit_minutes
							? formatMinutesText(draft.weekly_limit_minutes)
							: POLICY_FORM_COPY.none}
					</SettingsRow>
					<SettingsRow inline label={POLICY_FORM_COPY.presets}>
						{presetsLine(draft.shown_presets)}
					</SettingsRow>
				</SettingsRows>
			</SettingsSection>
		</div>
	);
}

// ── Form ────────────────────────────────────────────────────────────────────

/** The workspace the policy belongs to: its name for copy, slug and role for the plan notice. */
export type TimeSettingsWorkspace = Pick<Workspace, "id" | "name"> &
	Partial<Pick<Workspace, "slug" | "my_role">>;

export interface WorkspaceTimePolicyFormProps {
	workspace: TimeSettingsWorkspace;
	/** `GET /time/policies/workspaces/:id` (read by the page). */
	view: WorkspacePolicyView;
	/** The editor's browser timezone ("Detected from your browser"). */
	browserTimeZone?: string | null;
	/** Clock for "Applies from …" (tests). */
	now?: Date;
	className?: string;
}

export function WorkspaceTimePolicyForm({
	workspace,
	view,
	browserTimeZone,
	now,
	className,
}: WorkspaceTimePolicyFormProps) {
	const native = isNativeApp();
	const entitlements = useEntitlements(workspace.id);
	const policy = view.policy;
	const planOk = policy.plan?.time_tracking !== false;
	const planInfo = trackingPlanInfo(entitlements, planOk);
	const workspaceName = workspace.name?.trim() || "This workspace";

	const notice = planInfo ? (
		<div className="pt-6">
			<PlanLimitNotice
				info={planInfo}
				workspace={
					workspace.slug
						? {
								slug: workspace.slug,
								my_role: workspace.my_role ?? null,
								name: workspace.name,
							}
						: null
				}
				message={timePlanCopy("time_tracking", {
					workspaceName: workspace.name,
					native,
				})}
				detail={featureNoteCopy("time_tracking", false)}
				isComplimentary={entitlements.isComplimentary}
			/>
		</div>
	) : null;

	if (!view.can_edit) {
		return (
			<div className={className}>
				{notice}
				<ReadOnlyPolicy
					workspaceName={workspaceName}
					policy={policy}
					planOk={planOk}
				/>
			</div>
		);
	}

	return (
		<div className={className}>
			{notice}
			<PolicyEditor
				workspace={workspace}
				workspaceName={workspaceName}
				view={view}
				planOk={planOk}
				native={native}
				browserTimeZone={browserTimeZone}
				now={now}
			/>
		</div>
	);
}

function PolicyEditor({
	workspace,
	workspaceName,
	view,
	planOk,
	native,
	browserTimeZone,
	now,
}: {
	workspace: TimeSettingsWorkspace;
	workspaceName: string;
	view: WorkspacePolicyView;
	planOk: boolean;
	native: boolean;
	browserTimeZone?: string | null;
	now?: Date;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const ids = useId();
	const policy = view.policy;
	const base = useMemo(() => draftFromPolicy(policy), [policy]);
	const [edited, setEdited] = useState<PolicyDraft | null>(null);
	const draft = edited ?? base;
	const formRef = useRef<HTMLFormElement>(null);

	const save = useMutation({
		mutationFn: (body: WorkspaceTimePolicyInput) =>
			timeService.updateWorkspacePolicy(workspace.id, body),
		onSuccess: (next) => {
			qc.setQueryData(timeKeys.workspacePolicy(workspace.id), next);
			// The save bar goes away with nothing left to save; keep keyboard
			// focus in the form instead of dropping it on the page body.
			formRef.current?.focus({ preventScroll: true });
			setEdited(null);
			void invalidateTime(qc, "policy");
			toast.success(POLICY_FORM_COPY.saved);
		},
	});

	const patch = policyPatch(draft, policy, { planOk });
	const dirty = Object.keys(patch).length > 0;
	// Any PUT confirms; a Free workspace has nothing to confirm (no card either).
	const confirmOnly = !dirty && planOk && view.policy_unconfirmed;
	const pending = save.isPending;
	const gated = !planOk || pending;

	const update = (next: Partial<PolicyDraft>) => {
		if (save.isError) save.reset();
		setEdited({ ...draft, ...next });
	};

	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		if (pending || (!dirty && !confirmOnly)) return;
		save.mutate(dirty ? patch : { confirm: true });
	};

	const zones = useMemo(() => {
		const list = listTimeZones();
		const extra = [draft.timezone, browserTimeZone].filter(
			(zone): zone is string => Boolean(zone) && !list.includes(zone as string),
		);
		return [...new Set([...extra, ...list])];
	}, [draft.timezone, browserTimeZone]);

	const saveError =
		save.isError && !(isTimeApiError(save.error) && save.error.planLimit)
			? timeErrorMessage(save.error, {
					subject: "scope",
					operation: "write",
					label: workspace.name,
				})
			: null;

	const trackingOn = draft.tracking_enabled && planOk;
	const detected = showsDetectedTimezone(view, draft.timezone, browserTimeZone);
	const appliesFrom = periodChanged(draft, policy)
		? appliesFromLine(policy, now)
		: null;
	const chainsLabel = timePlanCopy("time_approval_chains", { native });

	const idOf = (name: string) => `${ids}-${name}`;
	const describe = (name: string) => `${ids}-${name}-hint`;

	return (
		<form
			ref={formRef}
			tabIndex={-1}
			aria-label={POLICY_FORM_COPY.formLabel}
			onSubmit={onSubmit}
			data-testid="time-policy-form"
			className="outline-none"
			noValidate
		>
			<SettingsSection
				id="time-policy-timesheets"
				title={POLICY_FORM_COPY.sectionTimesheets}
			>
				<SettingsRows>
					<SettingsRow
						label={POLICY_FORM_COPY.tracking}
						description={trackingDescription(workspaceName, trackingOn)}
					>
						<Toggle
							checked={trackingOn}
							onChange={(next) => update({ tracking_enabled: next })}
							label={POLICY_FORM_COPY.tracking}
							on={POLICY_FORM_COPY.on}
							off={POLICY_FORM_COPY.off}
							disabled={gated}
						/>
					</SettingsRow>

					<SettingsRow
						label={
							<span id={idOf("period-label")}>{POLICY_FORM_COPY.period}</span>
						}
						below={
							<div
								role="radiogroup"
								aria-labelledby={idOf("period-label")}
								className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-5"
							>
								{PERIOD_KINDS.map((kind) => (
									<label
										key={kind}
										className={cn(
											"inline-flex items-center gap-2 text-sm",
											gated ? "text-muted-foreground" : "text-foreground",
										)}
									>
										<input
											type="radio"
											name={idOf("period")}
											value={kind}
											checked={draft.period_kind === kind}
											disabled={gated}
											onChange={() => update({ period_kind: kind })}
											className={radioClass}
										/>
										{periodKindTitle(kind)}
									</label>
								))}
							</div>
						}
					/>

					<SettingsRow
						label={
							<label htmlFor={idOf("week-start")}>
								{POLICY_FORM_COPY.weekStartsOn}
							</label>
						}
					>
						<select
							id={idOf("week-start")}
							value={draft.week_start}
							disabled={pending}
							onChange={(event) =>
								update({ week_start: Number(event.target.value) })
							}
							className={selectClass}
						>
							{[1, 2, 3, 4, 5, 6, 7].map((day) => (
								<option key={day} value={day}>
									{weekdayName(day)}
								</option>
							))}
						</select>
					</SettingsRow>

					<SettingsRow
						label={
							<label htmlFor={idOf("timezone")}>
								{POLICY_FORM_COPY.timezone}
							</label>
						}
						description={
							<span id={describe("timezone")}>
								{detected
									? `${native ? POLICY_FORM_COPY.detectedDevice : POLICY_FORM_COPY.detectedBrowser} · `
									: null}
								{POLICY_FORM_COPY.timezoneHint}
							</span>
						}
					>
						<select
							id={idOf("timezone")}
							value={draft.timezone}
							disabled={pending}
							aria-describedby={describe("timezone")}
							onChange={(event) => update({ timezone: event.target.value })}
							className={cn(selectClass, "max-w-[16rem]")}
						>
							{zones.map((zone) => (
								<option key={zone} value={zone}>
									{zone}
								</option>
							))}
						</select>
					</SettingsRow>

					<SettingsRow
						label={
							<label htmlFor={idOf("reminder")}>
								{POLICY_FORM_COPY.reminder}
							</label>
						}
						below={
							<span className="inline-flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
								<span>{POLICY_FORM_COPY.reminderBefore}</span>
								<NumberField
									id={idOf("reminder")}
									inputMode="numeric"
									min={REMINDER_MIN}
									max={REMINDER_MAX}
									value={draft.reminder_days}
									format={(value) => String(value ?? "")}
									parse={(raw) =>
										parseWholeNumber(raw, REMINDER_MIN, REMINDER_MAX, undefined)
									}
									onValue={(value) =>
										update({ reminder_days: value ?? REMINDER_MIN })
									}
									disabled={gated}
									aria-describedby={describe("reminder")}
									className={numberClass}
								/>
								<span id={describe("reminder")}>
									{POLICY_FORM_COPY.reminderAfter}
								</span>
							</span>
						}
					/>
				</SettingsRows>

				{appliesFrom ? (
					<SettingsNotice
						tone="info"
						icon={Info}
						role="status"
						className="mt-5"
					>
						<span data-testid="time-policy-applies-from">{appliesFrom}</span>
					</SettingsNotice>
				) : null}
			</SettingsSection>

			<SettingsSection
				id="time-policy-approval"
				title={POLICY_FORM_COPY.sectionApproval}
			>
				<SettingsRows>
					<SettingsRow
						label={POLICY_FORM_COPY.approval}
						description={POLICY_FORM_COPY.approvers}
						below={
							chainsLabel ? (
								<p className="text-xs text-muted-foreground">{chainsLabel}</p>
							) : null
						}
					>
						<Toggle
							checked={draft.approval_required}
							onChange={(next) => update({ approval_required: next })}
							label={POLICY_FORM_COPY.approval}
							on={POLICY_FORM_COPY.required}
							off={POLICY_FORM_COPY.notRequired}
							disabled={gated}
						/>
					</SettingsRow>
				</SettingsRows>
			</SettingsSection>

			<SettingsSection
				id="time-policy-adding"
				title={POLICY_FORM_COPY.sectionAdding}
			>
				<SettingsRows>
					<SettingsRow
						label={POLICY_FORM_COPY.manual}
						below={
							<span className="inline-flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
								<span>{POLICY_FORM_COPY.manualUpTo}</span>
								<NumberField
									inputMode="numeric"
									min={0}
									max={RETRO_MAX}
									value={draft.retroactive_days}
									format={(value) => String(value ?? 0)}
									parse={(raw) => parseWholeNumber(raw, 0, RETRO_MAX, 0)}
									onValue={(value) => update({ retroactive_days: value ?? 0 })}
									disabled={gated || !draft.allow_manual_entries}
									aria-label={POLICY_FORM_COPY.manualWindow}
									className={numberClass}
								/>
								<span>{POLICY_FORM_COPY.manualDaysBack}</span>
							</span>
						}
					>
						<Toggle
							checked={draft.allow_manual_entries}
							onChange={(next) => update({ allow_manual_entries: next })}
							label={POLICY_FORM_COPY.manual}
							on={POLICY_FORM_COPY.allowed}
							off={POLICY_FORM_COPY.off}
							disabled={gated}
						/>
					</SettingsRow>

					<SettingsRow
						label={
							<label htmlFor={idOf("rounding")}>
								{POLICY_FORM_COPY.rounding}
							</label>
						}
						description={
							<span id={describe("rounding")}>
								{POLICY_FORM_COPY.roundingHint}
							</span>
						}
					>
						<select
							id={idOf("rounding")}
							value={draft.rounding_minutes}
							disabled={gated}
							aria-describedby={describe("rounding")}
							onChange={(event) =>
								update({ rounding_minutes: Number(event.target.value) })
							}
							className={selectClass}
						>
							{ROUNDING_OPTIONS.map((minutes) => (
								<option key={minutes} value={minutes}>
									{minutes === 0 ? POLICY_FORM_COPY.none : `${minutes} min`}
								</option>
							))}
						</select>
					</SettingsRow>

					<SettingsRow
						label={
							<label htmlFor={idOf("weekly-limit")}>
								{POLICY_FORM_COPY.weeklyLimit}
							</label>
						}
						description={
							<span id={describe("weekly-limit")}>
								{POLICY_FORM_COPY.weeklyLimitHint}
							</span>
						}
					>
						<span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
							<NumberField
								id={idOf("weekly-limit")}
								inputMode="decimal"
								min={1}
								max={WEEKLY_LIMIT_MAX_HOURS}
								step="any"
								value={draft.weekly_limit_minutes}
								format={hoursOf}
								parse={parseWeeklyLimitHours}
								onValue={(value) => update({ weekly_limit_minutes: value })}
								disabled={gated}
								aria-describedby={describe("weekly-limit")}
								className={numberClass}
							/>
							<span>{POLICY_FORM_COPY.weeklyLimitUnit}</span>
						</span>
					</SettingsRow>

					<SettingsRow
						label={
							<span id={idOf("presets-label")}>{POLICY_FORM_COPY.presets}</span>
						}
						description={
							<span id={describe("presets")}>
								{POLICY_FORM_COPY.presetsHint}
							</span>
						}
						below={
							<fieldset
								aria-labelledby={idOf("presets-label")}
								aria-describedby={describe("presets")}
								className="flex flex-wrap gap-x-5 gap-y-2"
							>
								{PRESET_WORK_ITEMS.map((item) => {
									const checked = draft.shown_presets.includes(item);
									return (
										<label
											key={item}
											className={cn(
												"inline-flex items-center gap-2 text-sm",
												gated ? "text-muted-foreground" : "text-foreground",
											)}
										>
											<input
												type="checkbox"
												checked={checked}
												disabled={gated}
												onChange={() =>
													update({
														shown_presets: checked
															? draft.shown_presets.filter((p) => p !== item)
															: PRESET_WORK_ITEMS.filter(
																	(p) =>
																		p === item ||
																		draft.shown_presets.includes(p),
																),
													})
												}
												className={checkboxClass}
											/>
											{workItemLabel(item)}
										</label>
									);
								})}
							</fieldset>
						}
					/>
				</SettingsRows>
			</SettingsSection>

			{dirty || confirmOnly ? (
				<SaveBar
					dirty={dirty}
					pending={pending}
					error={saveError}
					note={confirmOnly ? POLICY_FORM_COPY.unconfirmed : null}
					onCancel={() => {
						save.reset();
						// Cancel unmounts itself (and the bar, unless the policy still
						// needs confirming); keep keyboard focus in the form.
						formRef.current?.focus({ preventScroll: true });
						setEdited(null);
					}}
				/>
			) : null}
		</form>
	);
}

function SaveBar({
	dirty,
	pending,
	error,
	note,
	onCancel,
}: {
	dirty: boolean;
	pending: boolean;
	error: string | null;
	note: ReactNode;
	onCancel: () => void;
}) {
	return (
		<div
			data-testid="time-policy-save-bar"
			className="sticky bottom-0 z-10 -mx-5 border-t border-border bg-background px-5 py-3 md:-mx-10 md:px-10 lg:-mx-14 lg:px-14"
		>
			{error ? (
				<p role="alert" className="mb-2 text-sm text-destructive">
					{error}
				</p>
			) : null}
			<div className="flex flex-wrap items-center justify-end gap-2">
				{note ? (
					<p className="mr-auto min-w-0 basis-full text-sm text-muted-foreground sm:basis-auto">
						{note}
					</p>
				) : null}
				{dirty ? (
					<button
						type="button"
						className={settingsButton.secondary}
						disabled={pending}
						onClick={onCancel}
					>
						{POLICY_FORM_COPY.cancel}
					</button>
				) : null}
				<button
					type="submit"
					className={settingsButton.primary}
					disabled={pending}
				>
					{pending ? (
						<Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
					) : null}
					{POLICY_FORM_COPY.save}
				</button>
			</div>
		</div>
	);
}
