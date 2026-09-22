import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { computeMeter, type WorkspaceEntitlements } from "@/lib/entitlements";
import type { PlanLimitInfo } from "@/lib/planLimitErrors";
import {
	type CountKey,
	cellValue,
	DEFAULT_PLAN_LIMITS,
	type FeatureKey,
	limitDefinition,
	nextPlanWith,
} from "@/lib/planLimits";
import {
	meterCaption,
	planLimitTitle,
	planLimitToastCopy,
	upgradeCta,
} from "@/lib/usageCopy";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/services/workspaces.service";

/**
 * A plan limit, stated where the blocked action lives.
 *
 * Two sources feed it: a write the server refused (`PlanLimitError.info`), and
 * the workspace's usage read ahead of time (`countLimitInfo` /
 * `featureLimitInfo` below), which lets a page disable a button and say why
 * before anyone clicks it. Only owners can change the plan, so an owner gets
 * the upgrade link and everyone else is told who to ask.
 *
 * The wording comes from usageCopy.ts; this component only lays it out.
 */

export type PlanLimitNoticeInfo = Pick<
	PlanLimitInfo,
	"limitKey" | "kind" | "label" | "limit" | "used" | "plan" | "upgradePlan"
> &
	Partial<
		Pick<PlanLimitInfo, "message" | "context" | "workspaceId" | "workspaceSlug">
	>;

interface PlanLimitNoticeProps {
	info: PlanLimitNoticeInfo;
	/** The workspace the limit belongs to; its role decides the call to action. */
	workspace: Pick<Workspace, "slug" | "my_role"> | null | undefined;
	/** Replaces the default body copy. */
	message?: string | null;
	/** One more sentence after the body, e.g. "Existing logs stay readable." */
	detail?: string | null;
	/** A granted plan changes through Proyekto, so it gets no upgrade link. */
	isComplimentary?: boolean;
	variant?: "card" | "inline";
	className?: string;
}

function toFullInfo(info: PlanLimitNoticeInfo): PlanLimitInfo {
	return {
		message: "",
		context: null,
		workspaceId: null,
		workspaceSlug: null,
		...info,
	};
}

/** The body line: the server's own message, else the local wording. */
function defaultMessage(
	info: PlanLimitInfo,
	role: Workspace["my_role"],
): string {
	if (info.message) return info.message;
	if (info.kind === "count" && info.limit !== null && info.used !== null) {
		const caption = meterCaption(
			info.limitKey,
			computeMeter(info.used, info.limit),
			info.plan,
		);
		if (caption) return caption;
	}
	return planLimitToastCopy(info, role ?? null).message;
}

export function PlanLimitNotice({
	info,
	workspace,
	message,
	detail,
	isComplimentary = false,
	variant = "card",
	className,
}: PlanLimitNoticeProps) {
	const full = toFullInfo(info);
	const role = workspace?.my_role ?? null;
	const slug = workspace?.slug ?? full.workspaceSlug;
	const body = message ?? defaultMessage(full, role);
	const cta = upgradeCta({
		role,
		isComplimentary,
		upgradePlanName: full.upgradePlan,
	});

	return (
		<div
			role="status"
			className={cn(
				"flex gap-3 border border-warning/40 bg-warning/10 text-left",
				variant === "card" ? "rounded-2xl p-4" : "rounded-xl p-3",
				className,
			)}
		>
			<AlertTriangle
				className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground"
				aria-hidden="true"
			/>
			<div
				className={cn(
					"min-w-0 flex-1 space-y-1",
					variant === "card" ? "text-sm" : "text-xs",
				)}
			>
				<p className="font-semibold text-foreground">{planLimitTitle(full)}</p>
				<p className="text-muted-foreground">{body}</p>
				{detail ? <p className="text-muted-foreground">{detail}</p> : null}
				{cta.kind === "upgrade" && slug ? (
					<Link
						to="/w/$workspaceSlug/settings/billing"
						params={{ workspaceSlug: slug }}
						className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
					>
						{cta.label}
						<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
					</Link>
				) : cta.kind === "ask_owner" && !body.includes(cta.label) ? (
					<p className="font-medium text-foreground">{cta.label}</p>
				) : null}
			</div>
		</div>
	);
}

/**
 * The info for a workspace count that is already at its limit, or `null`
 * when another `count` still fits — including whenever usage is unknown, so a
 * page that disables on this fails open like the rest of the entitlement layer.
 */
export function countLimitInfo(
	entitlements: WorkspaceEntitlements,
	key: CountKey,
	count = 1,
): PlanLimitInfo | null {
	const { usage, plan } = entitlements;
	if (!usage || !plan || entitlements.canCreate(key, count)) return null;
	const used = entitlements.usedFor(key);
	return {
		limitKey: key,
		kind: "count",
		label: limitDefinition(key)?.label ?? key,
		limit: cellValue(entitlements.limits, key),
		used,
		plan,
		upgradePlan:
			entitlements.upgradePlan ??
			nextPlanWith(key, plan, DEFAULT_PLAN_LIMITS, (used ?? 0) + count),
		workspaceId: usage.workspace_id,
		workspaceSlug: null,
		context: "create",
		message: "",
	};
}

/** The info for a feature the workspace's plan lacks; `null` when it has it or usage is unknown. */
export function featureLimitInfo(
	entitlements: WorkspaceEntitlements,
	key: FeatureKey,
): PlanLimitInfo | null {
	const { usage, plan } = entitlements;
	if (!usage || !plan || entitlements.hasFeature(key)) return null;
	const feature = usage.features.find((item) => item.key === key);
	return {
		limitKey: key,
		kind: "feature",
		label: feature?.label ?? limitDefinition(key)?.label ?? key,
		limit: null,
		used: null,
		plan,
		upgradePlan:
			feature?.available_on ?? nextPlanWith(key, plan, DEFAULT_PLAN_LIMITS),
		workspaceId: usage.workspace_id,
		workspaceSlug: null,
		context: "enable",
		message: "",
	};
}
