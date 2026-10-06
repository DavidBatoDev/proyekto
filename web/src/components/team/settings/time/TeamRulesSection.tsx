import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";
import {
	featureLimitInfo,
	PlanLimitNotice,
} from "@/components/billing/PlanLimitNotice";
import { SettingSwitch } from "@/components/team-time/SettingSwitch";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import {
	SettingsSection,
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
	capitalize,
	formatLocalDay,
	periodKindLabel,
	periodKindTitle,
	weekdayName,
	weekdayShort,
} from "@/lib/timeFormat";
import { addDays, periodFor, safeTimezone } from "@/lib/timePeriods";
import { cn } from "@/lib/utils";
import { invalidateTime, timeKeys, timeQueries } from "@/queries/time";
import { isTimeApiError, timeService } from "@/services/time.service";
import type {
	PeriodKind,
	ResolvedTimePolicy,
	TeamPolicyOverride,
	TeamPolicyView,
	TeamTimePolicyInput,
} from "@/services/time.types";
import type { Workspace } from "@/services/workspaces.service";
import { OverrideRow } from "./OverrideRow";

/**
 * Team settings › Time › Team rules (ux.md › Team Override): who approves the
 * team's time, and the team's own period, manual-time, retroactive-window,
 * rounding and approval values on top of the workspace policy.
 *
 * - Reads `GET /time/policies/teams/:id` (team managers only; anyone else
 *   gets a 404 and the section renders nothing).
 * - Business only (`time_team_rules`). Without it the rows are read-only
 *   behind an inline plan notice, and stored overrides are kept ("Saved rules
 *   apply again when Acme is on Business.").
 * - D62: approvers, approval, the retroactive window and rounding are the
 *   team owner's (`can_edit_money_fields`); team admins change the period and
 *   manual time.
 * - Approval stays on while member rates are on (L23,
 *   `TEAM_RATES_REQUIRE_APPROVAL`): the switch is disabled with that reason.
 * - Dropping the last override as the owner removes the team's rules
 *   (`DELETE`), because an all-inherit row still moves the team's sheets to
 *   team scope (backend D28). A team admin can't delete, so their reset
 *   clears the field only.
 */

// ── Copy ────────────────────────────────────────────────────────────────────

export const TEAM_RULES_COPY = {
	title: "Team rules",
	tier: "Business",
	approvers: "Approvers",
	approversWorkspace: "Workspace owners and admins",
	approversTeam: "This team's owners and admins",
	period: "Timesheet period",
	weekStartsOn: "Week starts on",
	timezone: "Timezone",
	manual: "Manual time",
	allowed: "Allowed",
	off: "Off",
	retro: "Retroactive window",
	retroDays: "days back",
	retroHint: "0 = no limit",
	rounding: "Rounding",
	roundingHint: "Nearest, ties round up",
	approval: "Approval",
	required: "Required",
	notRequired: "Not required",
	approvalStaysOn: "Stays on while member rates are on.",
	approvalStaysOnNative: "Approval has to stay on for this team.",
	ownerOnly:
		"Only the team owner can change approvers, approval, the retroactive window and rounding.",
	saved: "Team rules saved",
} as const;

/** "Saved rules apply again when Acme is on Business." */
export function savedRulesCopy(workspaceName?: string | null): string {
	return `Saved rules apply again when ${workspaceName?.trim() || "your workspace"} is on Business.`;
}

/** "Applies from Mon Oct 6. Open timesheets keep their dates." (L40) */
export function appliesFromCopy(day: string): string {
	return `Applies from ${day}. Open timesheets keep their dates.`;
}

// ── Types and pure helpers ──────────────────────────────────────────────────

/** The team's workspace: its name for copy, slug and role for the plan notice. */
export type TeamTimeWorkspace = Pick<Workspace, "id"> &
	Partial<Pick<Workspace, "name" | "slug" | "my_role">>;

export type TeamRuleRow =
	| "approvers"
	| "period"
	| "manual"
	| "retro"
	| "rounding"
	| "approval";

/** Every field a team override stores (null = inherit). */
export const TEAM_RULE_FIELDS = [
	"period_kind",
	"week_start",
	"timezone",
	"period_anchor",
	"approval_required",
	"approver_scope",
	"allow_manual_entries",
	"retroactive_days",
	"rounding_minutes",
	"weekly_limit_minutes",
	"reminder_days",
] as const satisfies readonly (keyof TeamTimePolicyInput)[];

/** D62: rows only the team owner changes. */
export const OWNER_ONLY_ROWS: ReadonlySet<TeamRuleRow> = new Set([
	"approvers",
	"approval",
	"retro",
	"rounding",
]);

export const PERIOD_KINDS: readonly PeriodKind[] = [
	"weekly",
	"biweekly",
	"semi_monthly",
	"monthly",
];

export const ROUNDING_OPTIONS = [0, 5, 6, 10, 15, 30] as const;

export interface PeriodValue {
	period_kind: PeriodKind;
	week_start: number;
	timezone: string;
}

function isSet(value: unknown): boolean {
	return value !== null && value !== undefined;
}

function usesWeekStart(kind: PeriodKind): boolean {
	return kind === "weekly" || kind === "biweekly";
}

/** "Weekly · Mon · Asia/Manila", "Twice a month · Asia/Manila". */
export function periodSummary(value: PeriodValue): string {
	const parts = [capitalize(periodKindLabel(value.period_kind))];
	if (usesWeekStart(value.period_kind)) {
		const day = weekdayShort(value.week_start);
		if (day) parts.push(day);
	}
	if (value.timezone) parts.push(value.timezone);
	return parts.join(" · ");
}

export function manualSummary(allowed: boolean): string {
	return allowed ? "allowed" : "off";
}

/** "up to 7 days back"; "no limit" for 0 or none. */
export function retroSummary(days: number | null | undefined): string {
	if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) {
		return "no limit";
	}
	const n = Math.trunc(days);
	return `up to ${n} ${n === 1 ? "day" : "days"} back`;
}

export function roundingSummary(minutes: number | null | undefined): string {
	return typeof minutes === "number" && minutes > 0 ? `${minutes} min` : "none";
}

export function approvalSummary(required: boolean): string {
	return required ? "required" : "not required";
}

/** True when every stored field is null once `patch` is applied. */
export function overrideIsEmptyAfter(
	override: TeamPolicyOverride | null | undefined,
	patch: TeamTimePolicyInput,
): boolean {
	return TEAM_RULE_FIELDS.every((key) => {
		const value = Object.hasOwn(patch, key) ? patch[key] : override?.[key];
		return !isSet(value);
	});
}

/** True when the stored override sets anything at all. */
export function hasStoredRules(
	override: TeamPolicyOverride | null | undefined,
): boolean {
	return Boolean(override) && !overrideIsEmptyAfter(override, {});
}

/** The team's stored period, filled from the effective policy; null when it inherits. */
export function storedPeriod(
	override: TeamPolicyOverride | null | undefined,
	effective: ResolvedTimePolicy,
): PeriodValue | null {
	if (
		!override ||
		!(
			isSet(override.period_kind) ||
			isSet(override.week_start) ||
			isSet(override.timezone)
		)
	) {
		return null;
	}
	return {
		period_kind: override.period_kind ?? effective.period_kind,
		week_start: override.week_start ?? effective.week_start,
		timezone: override.timezone ?? effective.timezone,
	};
}

/**
 * The first day the team's next period starts under today's rules: a new
 * period, timezone or week start applies from there (L40).
 */
export function nextPeriodStart(
	effective: Pick<
		ResolvedTimePolicy,
		"period_kind" | "week_start" | "timezone" | "period_anchor"
	>,
	now: Date = new Date(),
): string | null {
	try {
		const current = periodFor(
			{
				kind: effective.period_kind,
				timezone: safeTimezone(effective.timezone),
				weekStart: effective.week_start,
				anchor: effective.period_anchor,
			},
			now,
		);
		return addDays(current.end, 1);
	} catch {
		return null;
	}
}

/**
 * The plan notice for team rules. The server's `has_team_rules` decides; the
 * workspace usage only shapes the notice, and stands in when it is unknown.
 */
export function teamRulesPlanInfo(
	entitlements: WorkspaceEntitlements,
	hasTeamRules: boolean,
): PlanLimitInfo | null {
	if (hasTeamRules) return null;
	return (
		featureLimitInfo(entitlements, "time_team_rules") ?? {
			limitKey: "time_team_rules",
			kind: "feature",
			label:
				limitDefinition("time_team_rules")?.label ??
				"Team approvers and time rules",
			limit: null,
			used: null,
			plan: entitlements.plan ?? "free",
			upgradePlan: "business",
			workspaceId: entitlements.usage?.workspace_id ?? null,
			workspaceSlug: null,
			context: "enable",
			message: "",
		}
	);
}

// ── Editors ─────────────────────────────────────────────────────────────────

const selectClass = cn(settingsInput, "w-auto max-w-full py-1.5");
const radioClass = "h-4 w-4 shrink-0 accent-primary";

function PeriodEditor({
	value,
	onChange,
}: {
	value: PeriodValue;
	onChange: (next: PeriodValue) => void;
}) {
	const name = useId();
	const zones = useMemo(() => {
		const list = listTimeZones();
		return list.includes(value.timezone) ? list : [value.timezone, ...list];
	}, [value.timezone]);
	return (
		<>
			<div
				role="radiogroup"
				aria-label={TEAM_RULES_COPY.period}
				className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-5"
			>
				{PERIOD_KINDS.map((kind) => (
					<label
						key={kind}
						className="inline-flex items-center gap-2 text-sm text-foreground"
					>
						<input
							type="radio"
							name={name}
							value={kind}
							checked={value.period_kind === kind}
							onChange={() => onChange({ ...value, period_kind: kind })}
							className={radioClass}
						/>
						{periodKindTitle(kind)}
					</label>
				))}
			</div>
			<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-x-6">
				{usesWeekStart(value.period_kind) ? (
					<label className="flex flex-wrap items-center gap-2 text-sm">
						<span className="text-muted-foreground">
							{TEAM_RULES_COPY.weekStartsOn}
						</span>
						<select
							value={value.week_start}
							onChange={(event) =>
								onChange({ ...value, week_start: Number(event.target.value) })
							}
							className={selectClass}
						>
							{[1, 2, 3, 4, 5, 6, 7].map((day) => (
								<option key={day} value={day}>
									{weekdayName(day)}
								</option>
							))}
						</select>
					</label>
				) : null}
				<label className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
					<span className="text-muted-foreground">
						{TEAM_RULES_COPY.timezone}
					</span>
					<select
						value={value.timezone}
						onChange={(event) =>
							onChange({ ...value, timezone: event.target.value })
						}
						className={selectClass}
					>
						{zones.map((zone) => (
							<option key={zone} value={zone}>
								{zone}
							</option>
						))}
					</select>
				</label>
			</div>
		</>
	);
}

function SwitchEditor({
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
		<div className="flex items-center gap-3">
			<SettingSwitch
				checked={checked}
				onChange={onChange}
				label={label}
				disabled={disabled}
			/>
			<span className="text-sm text-foreground">{checked ? on : off}</span>
		</div>
	);
}

function RetroEditor({
	value,
	onChange,
}: {
	value: number;
	onChange: (next: number) => void;
}) {
	return (
		<label className="flex flex-wrap items-center gap-2 text-sm">
			<input
				type="number"
				inputMode="numeric"
				min={0}
				max={3650}
				value={value}
				onChange={(event) => {
					const n = Math.trunc(Number(event.target.value || 0));
					onChange(Number.isFinite(n) ? Math.min(3650, Math.max(0, n)) : 0);
				}}
				aria-label={TEAM_RULES_COPY.retro}
				className={cn(settingsInput, "w-24 py-1.5 tabular-nums")}
			/>
			<span className="text-muted-foreground">
				{TEAM_RULES_COPY.retroDays} · {TEAM_RULES_COPY.retroHint}
			</span>
		</label>
	);
}

function RoundingEditor({
	value,
	onChange,
}: {
	value: number;
	onChange: (next: number) => void;
}) {
	return (
		<label className="flex flex-wrap items-center gap-2 text-sm">
			<select
				value={value}
				onChange={(event) => onChange(Number(event.target.value))}
				aria-label={TEAM_RULES_COPY.rounding}
				className={selectClass}
			>
				{ROUNDING_OPTIONS.map((minutes) => (
					<option key={minutes} value={minutes}>
						{minutes === 0 ? "None" : `${minutes} min`}
					</option>
				))}
			</select>
			<span className="text-muted-foreground">
				{TEAM_RULES_COPY.roundingHint}
			</span>
		</label>
	);
}

// ── Rows ────────────────────────────────────────────────────────────────────

type WriteMode = "save" | "reset";

interface RuleRowProps<T> {
	row: TeamRuleRow;
	label: string;
	workspaceName: string | null;
	/** The team's own value; null when the row inherits. */
	stored: T | null;
	/** The value in force when the row inherits. */
	inherited: T;
	summary: (value: T) => string;
	canEdit: boolean;
	pending: boolean;
	hint?: (draft: T, state: { editing: boolean; dirty: boolean }) => ReactNode;
	toPatch: (value: T) => TeamTimePolicyInput;
	resetPatch: TeamTimePolicyInput;
	onWrite: (
		row: TeamRuleRow,
		patch: TeamTimePolicyInput,
		mode: WriteMode,
	) => void;
	renderEditor: (value: T, onChange: (next: T) => void) => ReactNode;
}

function sameValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A row's draft lives here; the parent keys the row by its stored value, so
 * a saved or reset row starts again from what the server answered.
 */
function RuleRow<T>({
	row,
	label,
	workspaceName,
	stored,
	inherited,
	summary,
	canEdit,
	pending,
	hint,
	toPatch,
	resetPatch,
	onWrite,
	renderEditor,
}: RuleRowProps<T>) {
	const base = stored ?? inherited;
	const [draft, setDraft] = useState<T>(base);
	const [editing, setEditing] = useState(false);
	const overridden = stored !== null;
	const dirty = !sameValue(draft, base);
	return (
		<OverrideRow
			id={`team-rule-${row}`}
			label={label}
			workspaceName={workspaceName}
			inheritedSummary={summary(inherited)}
			overridden={overridden}
			editing={editing}
			canEdit={canEdit}
			dirty={dirty}
			pending={pending}
			hint={hint?.(draft, { editing: editing || overridden, dirty })}
			onOverride={() => {
				setDraft(base);
				setEditing(true);
			}}
			onCancel={() => {
				setDraft(base);
				setEditing(false);
			}}
			onSave={() => onWrite(row, toPatch(draft), "save")}
			onReset={() => onWrite(row, resetPatch, "reset")}
		>
			{renderEditor(draft, setDraft)}
		</OverrideRow>
	);
}

function ApproversRow({
	value,
	canEdit,
	pending,
	onChange,
}: {
	value: "team" | "workspace";
	canEdit: boolean;
	pending: boolean;
	onChange: (next: "team" | "workspace") => void;
}) {
	const name = useId();
	const labelId = "team-rule-approvers-label";
	const options = [
		{ value: "workspace" as const, label: TEAM_RULES_COPY.approversWorkspace },
		{ value: "team" as const, label: TEAM_RULES_COPY.approversTeam },
	];
	return (
		<div data-testid="approvers-row" className="py-4 first:pt-0 last:pb-0">
			<div
				id={labelId}
				className="text-sm font-medium leading-5 text-foreground"
			>
				{TEAM_RULES_COPY.approvers}
			</div>
			<div
				role="radiogroup"
				aria-labelledby={labelId}
				className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6"
			>
				{options.map((option) => (
					<label
						key={option.value}
						className={cn(
							"inline-flex items-center gap-2 text-sm",
							canEdit ? "text-foreground" : "text-muted-foreground",
						)}
					>
						<input
							type="radio"
							name={name}
							value={option.value}
							checked={value === option.value}
							disabled={!canEdit || pending}
							onChange={() => onChange(option.value)}
							className={radioClass}
						/>
						{option.label}
					</label>
				))}
			</div>
		</div>
	);
}

function ApprovalLockedRow({ native }: { native: boolean }) {
	return (
		<div
			data-testid="approval-locked-row"
			className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-4 first:pt-0 last:pb-0"
		>
			<div className="min-w-0 grow basis-48">
				<div className="text-sm font-medium leading-5 text-foreground">
					{TEAM_RULES_COPY.approval}
				</div>
				<div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
					{native
						? TEAM_RULES_COPY.approvalStaysOnNative
						: TEAM_RULES_COPY.approvalStaysOn}
				</div>
			</div>
			<SwitchEditor
				checked
				onChange={() => {}}
				label={TEAM_RULES_COPY.approval}
				on={TEAM_RULES_COPY.required}
				off={TEAM_RULES_COPY.notRequired}
				disabled
			/>
		</div>
	);
}

// ── Section ─────────────────────────────────────────────────────────────────

export interface TeamRulesSectionProps {
	teamId: string;
	/** The team's workspace (copy, plan notice). */
	workspace: TeamTimeWorkspace | null;
	/** `teams.member_rates_enabled`: approval stays on (L23). */
	memberRatesEnabled: boolean;
	/** Clock for "Applies from …" (tests). */
	now?: Date;
	className?: string;
}

interface WriteVars {
	row: TeamRuleRow;
	patch: TeamTimePolicyInput;
	mode: WriteMode;
	override: TeamPolicyOverride | null;
	canDelete: boolean;
}

export function TeamRulesSection({
	teamId,
	workspace,
	memberRatesEnabled,
	now,
	className,
}: TeamRulesSectionProps) {
	const qc = useQueryClient();
	const toast = useToast();
	const native = isNativeApp();
	const entitlements = useEntitlements(workspace?.id ?? null);
	const policyQuery = useQuery(timeQueries.teamPolicy(teamId));
	const view = policyQuery.data;

	const write = useMutation({
		mutationFn: async (vars: WriteVars): Promise<TeamPolicyView | null> => {
			if (vars.mode === "reset") {
				if (!vars.override) return null;
				if (vars.canDelete && overrideIsEmptyAfter(vars.override, vars.patch)) {
					return timeService.deleteTeamPolicy(teamId);
				}
			}
			return timeService.updateTeamPolicy(teamId, vars.patch);
		},
		onSuccess: (next) => {
			if (next) qc.setQueryData(timeKeys.teamPolicy(teamId), next);
			void invalidateTime(qc, "policy");
			toast.success(TEAM_RULES_COPY.saved);
		},
		onError: (error) => {
			// The plan prompt is raised globally (api/axios notifyPlanLimit).
			if (isTimeApiError(error) && error.planLimit) return;
			toast.error(
				timeErrorMessage(error, { subject: "scope", operation: "write" }),
			);
		},
	});

	const title = (
		<span className="inline-flex flex-wrap items-center gap-2">
			{TEAM_RULES_COPY.title}
			<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
				{TEAM_RULES_COPY.tier}
			</span>
		</span>
	);

	if (policyQuery.isError) {
		// Only team managers can read the rules; for anyone else this is a 404.
		if (isTimeApiError(policyQuery.error) && policyQuery.error.status === 404) {
			return null;
		}
		return (
			<SettingsSection id="team-rules" title={title} className={className}>
				<TimeReasonCard
					variant="inline"
					role="alert"
					tone="danger"
					title={timeErrorMessage(policyQuery.error, {
						subject: "scope",
						operation: "read",
					})}
				/>
			</SettingsSection>
		);
	}

	if (!view) {
		return (
			<SettingsSection id="team-rules" title={title} className={className}>
				<div className="flex py-4" data-testid="team-rules-loading">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			</SettingsSection>
		);
	}

	const effective = view.effective;
	const override = view.override ?? null;
	const hasRules = view.has_team_rules;
	const isOwner = view.can_edit_money_fields;
	const workspaceName = workspace?.name ?? null;
	const planInfo = teamRulesPlanInfo(entitlements, hasRules);
	const pendingRow = write.isPending ? write.variables?.row : null;
	const canEditRow = (row: TeamRuleRow) =>
		hasRules && (!OWNER_ONLY_ROWS.has(row) || isOwner);
	const onWrite = (
		row: TeamRuleRow,
		patch: TeamTimePolicyInput,
		mode: WriteMode,
	) => write.mutate({ row, patch, mode, override, canDelete: isOwner });

	const period = storedPeriod(override, effective);
	const inheritedPeriod: PeriodValue = {
		period_kind: effective.period_kind,
		week_start: effective.week_start,
		timezone: effective.timezone,
	};
	const nextStart = nextPeriodStart(effective, now);
	const nextStartLabel = nextStart
		? formatLocalDay(nextStart, { weekday: true, now })
		: null;

	const manualStored = isSet(override?.allow_manual_entries)
		? Boolean(override?.allow_manual_entries)
		: null;
	const retroStored = isSet(override?.retroactive_days)
		? Number(override?.retroactive_days)
		: null;
	const roundingStored = isSet(override?.rounding_minutes)
		? Number(override?.rounding_minutes)
		: null;
	const approvalStored = isSet(override?.approval_required)
		? Boolean(override?.approval_required)
		: null;
	const approvers: "team" | "workspace" =
		override?.approver_scope === "team" ? "team" : "workspace";
	const rowKey = (row: TeamRuleRow, stored: unknown, inherited: unknown) =>
		`${row}:${JSON.stringify(stored)}:${stored === null ? JSON.stringify(inherited) : ""}`;

	return (
		<SettingsSection id="team-rules" title={title} className={className}>
			{planInfo ? (
				<PlanLimitNotice
					info={planInfo}
					workspace={
						workspace?.slug
							? { slug: workspace.slug, my_role: workspace.my_role ?? null }
							: null
					}
					message={timePlanCopy("time_team_rules", { workspaceName, native })}
					detail={
						hasStoredRules(override) ? savedRulesCopy(workspaceName) : null
					}
					isComplimentary={entitlements.isComplimentary}
					variant="inline"
					className="mb-5"
				/>
			) : null}

			<div className="divide-y divide-border" data-testid="team-rules">
				<ApproversRow
					value={approvers}
					canEdit={canEditRow("approvers")}
					pending={pendingRow === "approvers"}
					onChange={(next) => {
						if (next === approvers) return;
						if (next === "team") {
							onWrite("approvers", { approver_scope: "team" }, "save");
						} else {
							onWrite("approvers", { approver_scope: null }, "reset");
						}
					}}
				/>

				<RuleRow<PeriodValue>
					key={rowKey("period", period, inheritedPeriod)}
					row="period"
					label={TEAM_RULES_COPY.period}
					workspaceName={workspaceName}
					stored={period}
					inherited={inheritedPeriod}
					summary={periodSummary}
					canEdit={canEditRow("period")}
					pending={pendingRow === "period"}
					hint={(_draft, state) =>
						canEditRow("period") &&
						state.editing &&
						state.dirty &&
						nextStartLabel
							? appliesFromCopy(nextStartLabel)
							: null
					}
					toPatch={(value) => ({
						period_kind: value.period_kind,
						week_start: value.week_start,
						timezone: value.timezone,
					})}
					resetPatch={{
						period_kind: null,
						week_start: null,
						timezone: null,
						period_anchor: null,
					}}
					onWrite={onWrite}
					renderEditor={(value, onChange) => (
						<PeriodEditor value={value} onChange={onChange} />
					)}
				/>

				<RuleRow<boolean>
					key={rowKey("manual", manualStored, effective.allow_manual_entries)}
					row="manual"
					label={TEAM_RULES_COPY.manual}
					workspaceName={workspaceName}
					stored={manualStored}
					inherited={effective.allow_manual_entries}
					summary={manualSummary}
					canEdit={canEditRow("manual")}
					pending={pendingRow === "manual"}
					toPatch={(value) => ({ allow_manual_entries: value })}
					resetPatch={{ allow_manual_entries: null }}
					onWrite={onWrite}
					renderEditor={(value, onChange) => (
						<SwitchEditor
							checked={value}
							onChange={onChange}
							label={TEAM_RULES_COPY.manual}
							on={TEAM_RULES_COPY.allowed}
							off={TEAM_RULES_COPY.off}
						/>
					)}
				/>

				<RuleRow<number>
					key={rowKey("retro", retroStored, effective.retroactive_days)}
					row="retro"
					label={TEAM_RULES_COPY.retro}
					workspaceName={workspaceName}
					stored={retroStored}
					inherited={Math.max(0, Number(effective.retroactive_days ?? 0))}
					summary={retroSummary}
					canEdit={canEditRow("retro")}
					pending={pendingRow === "retro"}
					toPatch={(value) => ({ retroactive_days: value })}
					resetPatch={{ retroactive_days: null }}
					onWrite={onWrite}
					renderEditor={(value, onChange) => (
						<RetroEditor value={value} onChange={onChange} />
					)}
				/>

				<RuleRow<number>
					key={rowKey("rounding", roundingStored, effective.rounding_minutes)}
					row="rounding"
					label={TEAM_RULES_COPY.rounding}
					workspaceName={workspaceName}
					stored={roundingStored}
					inherited={Number(effective.rounding_minutes ?? 0)}
					summary={roundingSummary}
					canEdit={canEditRow("rounding")}
					pending={pendingRow === "rounding"}
					toPatch={(value) => ({ rounding_minutes: value })}
					resetPatch={{ rounding_minutes: null }}
					onWrite={onWrite}
					renderEditor={(value, onChange) => (
						<RoundingEditor value={value} onChange={onChange} />
					)}
				/>

				{memberRatesEnabled ? (
					<ApprovalLockedRow native={native} />
				) : (
					<RuleRow<boolean>
						key={rowKey(
							"approval",
							approvalStored,
							effective.approval_required,
						)}
						row="approval"
						label={TEAM_RULES_COPY.approval}
						workspaceName={workspaceName}
						stored={approvalStored}
						inherited={effective.approval_required}
						summary={approvalSummary}
						canEdit={canEditRow("approval")}
						pending={pendingRow === "approval"}
						toPatch={(value) => ({ approval_required: value })}
						resetPatch={{ approval_required: null }}
						onWrite={onWrite}
						renderEditor={(value, onChange) => (
							<SwitchEditor
								checked={value}
								onChange={onChange}
								label={TEAM_RULES_COPY.approval}
								on={TEAM_RULES_COPY.required}
								off={TEAM_RULES_COPY.notRequired}
							/>
						)}
					/>
				)}
			</div>

			{hasRules && !isOwner ? (
				<p
					data-testid="team-rules-owner-only"
					className="mt-4 text-xs leading-relaxed text-muted-foreground"
				>
					{TEAM_RULES_COPY.ownerOnly}
				</p>
			) : null}
		</SettingsSection>
	);
}
