// web/src/components/time/page/LimitBanner.tsx
//
// Two banners about limits on the Time page.
//
// `LimitBanner`: hours against a weekly or monthly limit (the port of
// `team-time/HourCapBanner.tsx`, ux.md › Pieces to reuse › Hour warnings:
// "Fed from the context policy and the governing engagement's limit (L12)").
// It is an indicator only. A workspace or team policy limit never cuts
// payable time (D65), so its line never says or implies that it does; it only
// turns amber. An agreement's own limit and a team member's cap can cut
// payable time at approval, so those turn red when exceeded.
//
//   ⏱ Weekly limit 40h (Prodigitality) · 38:15 logged · within limit
//   ⏱ Weekly limit 40h in the agreement with Acme Corp · 43:30 logged · 3:30 over
//   ⏱ Your monthly limit 160h (Prodigitality Services Inc. Team) · 150:00 logged · within limit
//
// `TimePlanBanner`: the one dismissible, owner-only plan notice (ux.md ›
// Personas P1, Plan copy): "Timesheets and approvals are part of Pro. Upgrade
// Acme to send time for approval." After a downgrade, everyone with open
// timesheets there reads "Acme's plan no longer includes timesheets. Your
// existing time is safe, and open timesheets can still be decided."

import { AlertTriangle, Clock, X } from "lucide-react";
import { useState } from "react";
import {
	featureLimitInfo,
	PlanLimitNotice,
} from "@/components/billing/PlanLimitNotice";
import { useEntitlements } from "@/hooks/useEntitlements";
import {
	nativeSafe,
	timePlanCopy,
	timePlanDowngradeCopy,
	weeklyLimitLine,
} from "@/lib/timeErrors";
import { formatClock, formatMinutesText } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import type {
	EntryWarning,
	ResolvedTimePolicy,
	TimesheetSummary,
} from "@/services/time.types";
import type { Workspace } from "@/services/workspaces.service";

// ── Hours against a limit ───────────────────────────────────────────────────

/**
 * Where a limit comes from:
 * - `policy`: the workspace or team time policy (an indicator, D65);
 * - `agreement`: the governing agreement's own weekly limit (cuts payable time);
 * - `member`: a team member's weekly or monthly cap (cuts payable time).
 */
export type LimitSource = "policy" | "agreement" | "member";

export interface LimitReading {
	source: LimitSource;
	window: "weekly" | "monthly";
	/** The policy owner, the agreement's counterparty, or the team. */
	label?: string | null;
	/** Must be > 0; anything else is dropped. */
	limitMinutes: number;
	/** Logged in the current window (seconds, net of breaks). */
	loggedSeconds: number;
}

export type LimitTone = "neutral" | "near" | "over";

/** At or past this share of the limit, the line turns amber. */
export const LIMIT_NEAR_RATIO = 0.85;

/** Policy limits only ever warn; agreement and member caps cut pay when exceeded. */
export function limitCuts(reading: Pick<LimitReading, "source">): boolean {
	return reading.source !== "policy";
}

export function limitTone(
	reading: Pick<LimitReading, "limitMinutes" | "loggedSeconds">,
): LimitTone {
	const limitSeconds = reading.limitMinutes * 60;
	if (limitSeconds <= 0) return "neutral";
	if (reading.loggedSeconds > limitSeconds) return "over";
	return reading.loggedSeconds >= limitSeconds * LIMIT_NEAR_RATIO
		? "near"
		: "neutral";
}

/**
 * One reading as a sentence. Weekly policy and agreement lines are the review
 * screen's (`weeklyLimitLine`); a member cap reads "Your weekly limit …" or
 * "Your monthly limit …" in the same shape.
 */
export function limitLine(reading: LimitReading): string {
	if (reading.source !== "member" && reading.window === "weekly") {
		return weeklyLimitLine({
			source: reading.source,
			label: reading.label,
			limitMinutes: reading.limitMinutes,
			loggedSeconds: reading.loggedSeconds,
		});
	}
	const label = reading.label?.trim();
	const window = reading.window === "monthly" ? "monthly" : "weekly";
	const head =
		reading.source === "member"
			? `Your ${window} limit`
			: `${window === "monthly" ? "Monthly" : "Weekly"} limit`;
	const over = Math.max(0, reading.loggedSeconds - reading.limitMinutes * 60);
	const tail = over > 0 ? `${formatClock(over)} over` : "within limit";
	return `${head} ${formatMinutesText(reading.limitMinutes)}${label ? ` (${label})` : ""} · ${formatClock(reading.loggedSeconds)} logged · ${tail}`;
}

function positive(value: number | null | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: null;
}

/**
 * The limits a context's resolved policy sets (`GET …/policy?for=`):
 * `weekly_limit_minutes` (from the agreement when its source is `contract`,
 * else from the workspace or team policy) and the member caps (team context).
 * A monthly cap is read only when `monthLoggedSeconds` is given.
 */
export function limitReadingsFromPolicy(
	policy: Pick<ResolvedTimePolicy, "weekly_limit_minutes" | "sources"> & {
		member?: ResolvedTimePolicy["member"];
	},
	context: {
		/** The context's label ("Prodigitality Services Inc. Team", "Acme Corp"). */
		label?: string | null;
		weekLoggedSeconds: number;
		monthLoggedSeconds?: number | null;
	},
): LimitReading[] {
	const out: LimitReading[] = [];
	const weekly = positive(policy.weekly_limit_minutes);
	if (weekly !== null) {
		out.push({
			source:
				policy.sources?.weekly_limit_minutes === "contract"
					? "agreement"
					: "policy",
			window: "weekly",
			label: context.label,
			limitMinutes: weekly,
			loggedSeconds: context.weekLoggedSeconds,
		});
	}
	const memberWeekly = positive(policy.member?.weekly_limit_hours);
	if (memberWeekly !== null) {
		out.push({
			source: "member",
			window: "weekly",
			label: context.label,
			limitMinutes: Math.round(memberWeekly * 60),
			loggedSeconds: context.weekLoggedSeconds,
		});
	}
	const memberMonthly = positive(policy.member?.monthly_limit_hours);
	if (
		memberMonthly !== null &&
		typeof context.monthLoggedSeconds === "number"
	) {
		out.push({
			source: "member",
			window: "monthly",
			label: context.label,
			limitMinutes: Math.round(memberMonthly * 60),
			loggedSeconds: context.monthLoggedSeconds,
		});
	}
	return out;
}

/**
 * The limits a write just reported (`warnings[]` on start, create and PATCH):
 * `POLICY_WEEKLY_LIMIT` (A6, indicator) and `CONTRACT_WEEKLY_LIMIT`.
 */
export function limitReadingsFromWarnings(
	warnings: readonly EntryWarning[] | null | undefined,
	context: { agreementLabel?: string | null } = {},
): LimitReading[] {
	const out: LimitReading[] = [];
	for (const warning of warnings ?? []) {
		if (warning.code === "POLICY_WEEKLY_LIMIT") {
			out.push({
				source: "policy",
				window: "weekly",
				label: warning.label,
				limitMinutes: warning.limit_minutes,
				loggedSeconds: warning.logged_minutes * 60,
			});
		} else if (warning.code === "CONTRACT_WEEKLY_LIMIT") {
			out.push({
				source: "agreement",
				window: "weekly",
				label: context.agreementLabel,
				limitMinutes: warning.limit_minutes,
				loggedSeconds: warning.logged_minutes * 60,
			});
		}
	}
	return out;
}

const TONE_CLASS: Record<LimitTone | "over_cut", string> = {
	neutral: "border-border bg-card text-muted-foreground",
	near: "border-warning/40 bg-warning/10 text-foreground",
	over: "border-warning/40 bg-warning/10 text-foreground",
	over_cut: "border-destructive/40 bg-destructive/10 text-destructive",
};

export interface LimitBannerProps {
	readings: readonly LimitReading[];
	className?: string;
}

export function LimitBanner({ readings, className }: LimitBannerProps) {
	const valid = readings.filter((reading) => reading.limitMinutes > 0);
	if (valid.length === 0) return null;
	return (
		<div
			role="status"
			data-testid="time-limit-banner"
			className={cn("flex flex-wrap gap-2", className)}
		>
			{valid.map((reading) => {
				const tone = limitTone(reading);
				const style = tone === "over" && limitCuts(reading) ? "over_cut" : tone;
				const Icon = tone === "over" ? AlertTriangle : Clock;
				return (
					<p
						key={`${reading.source}:${reading.window}:${reading.label ?? ""}`}
						data-source={reading.source}
						data-tone={style}
						className={cn(
							"inline-flex min-w-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium tabular-nums",
							TONE_CLASS[style],
						)}
					>
						<Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
						<span className="min-w-0">{nativeSafe(limitLine(reading))}</span>
					</p>
				);
			})}
		</div>
	);
}

// ── The plan notice ─────────────────────────────────────────────────────────

/** Per workspace, so dismissing one workspace's notice leaves the others. */
export const TIME_PLAN_NOTICE_STORAGE_PREFIX = "time-plan-notice-dismissed:";

export const TIME_PLAN_BANNER_COPY = { dismiss: "Dismiss" } as const;

function storageKey(workspaceId: string, kind: "upgrade" | "downgrade") {
	return `${TIME_PLAN_NOTICE_STORAGE_PREFIX}${kind}:${workspaceId}`;
}

function readDismissed(key: string): boolean {
	try {
		return globalThis.localStorage?.getItem(key) === "1";
	} catch {
		return false;
	}
}

function writeDismissed(key: string): void {
	try {
		globalThis.localStorage?.setItem(key, "1");
	} catch {
		// Storage unavailable: the notice shows again next time.
	}
}

/**
 * True when the person still has undecided timesheets under the workspace's
 * policy: after a downgrade their time is safe and those sheets can still be
 * decided (ux.md › Plan copy › Downgrade).
 */
export function planDowngradeApplies(
	sheets:
		| readonly Pick<TimesheetSummary, "policy_workspace_id" | "status">[]
		| null
		| undefined,
	workspaceId: string | null | undefined,
): boolean {
	if (!workspaceId) return false;
	return (sheets ?? []).some(
		(sheet) =>
			sheet.policy_workspace_id === workspaceId && sheet.status !== "approved",
	);
}

export interface TimePlanBannerProps {
	/** The workspace whose plan is checked (`useCurrentWorkspace().workspace`). */
	workspace:
		| Pick<Workspace, "id" | "name" | "slug" | "my_role">
		| null
		| undefined;
	/**
	 * The plan no longer has timesheets but this person has undecided ones
	 * there (`planDowngradeApplies`): everyone reads the downgrade line.
	 * Otherwise only the owner sees the upgrade line.
	 */
	downgraded?: boolean;
	className?: string;
}

export function TimePlanBanner({
	workspace,
	downgraded = false,
	className,
}: TimePlanBannerProps) {
	const entitlements = useEntitlements(workspace?.id ?? null);
	const kind = downgraded ? "downgrade" : "upgrade";
	const key = workspace ? storageKey(workspace.id, kind) : null;
	const [dismissedKey, setDismissedKey] = useState<string | null>(null);

	if (!workspace || !key) return null;
	// Fails open: no notice while the plan is unknown or has timesheets.
	const info = featureLimitInfo(entitlements, "time_tracking");
	if (!info) return null;
	if (!downgraded && workspace.my_role !== "owner") return null;
	if (dismissedKey === key || readDismissed(key)) return null;

	const message = downgraded
		? timePlanDowngradeCopy({ workspaceName: workspace.name })
		: timePlanCopy("time_tracking", { workspaceName: workspace.name });
	if (!message) return null;

	return (
		<div
			data-testid="time-plan-banner"
			data-kind={kind}
			className={cn(
				"flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5",
				className,
			)}
		>
			<PlanLimitNotice
				info={{ ...info, workspaceSlug: workspace.slug }}
				workspace={workspace}
				message={nativeSafe(message)}
				isComplimentary={entitlements.isComplimentary}
				className="min-w-0 flex-1"
			/>
			<button
				type="button"
				aria-label={TIME_PLAN_BANNER_COPY.dismiss}
				title={TIME_PLAN_BANNER_COPY.dismiss}
				onClick={() => {
					writeDismissed(key);
					setDismissedKey(key);
				}}
				className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
			>
				<X className="h-4 w-4" aria-hidden="true" />
			</button>
		</div>
	);
}
