/**
 * Every sentence the product says about plan limits.
 *
 * The companion to billingCopy.ts, which covers money and deliberately says
 * nothing about limits. The numbers themselves are never written here: they
 * come from the live, admin-edited matrix and are passed in, so this module
 * holds wording only and cannot drift from what the backend enforces.
 *
 * Two rules hold everywhere in here, and a test enforces both:
 *
 *  1. A limit never takes anything away. Reaching or going over one blocks
 *     NEW work only; everything already there stays readable and editable.
 *     So no copy may suggest deleting, removing or losing anything — a
 *     customer who reads that pauses their work to "clean up" data we never
 *     touch.
 *
 *  2. At or over a limit, say plainly that existing work stays. That sentence
 *     is the one that stops a support ticket.
 */

import type { MeterState } from "./entitlements";
import type { PlanLimitInfo } from "./planLimitErrors";
import {
	formatCount,
	type LimitCellMap,
	type LimitKey,
	limitDefinition,
	type PlanId,
	planLabel,
} from "./planLimits";

/** The viewer's workspace role; `null` when they are not a member. */
export type ViewerRole = "owner" | "admin" | "member" | null | undefined;

export const COMPLIMENTARY_BADGE = "Complimentary";

const STAYS = "Everything you have stays.";

function units(key: LimitKey | string): { singular: string; plural: string } {
	return limitDefinition(key)?.unit ?? { singular: "item", plural: "items" };
}

/** "1 project" / "3 projects" / "2,000 messages". */
export function countNoun(key: LimitKey | string, n: number): string {
	const unit = units(key);
	return `${formatCount(n)} ${n === 1 ? unit.singular : unit.plural}`;
}

/** What is blocked once the limit is reached, as a sentence subject. */
function blockedSubject(key: LimitKey | string): string {
	return key === "members" ? "new invites" : `new ${units(key).plural}`;
}

const capitalize = (text: string) =>
	text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Lowercase a label's first letter unless it opens an acronym, so "Change
 * requests" reads mid-sentence while "MCP server" keeps its capitals.
 */
function inSentence(label: string): string {
	const second = label.charAt(1);
	return second && second === second.toLowerCase()
		? label.charAt(0).toLowerCase() + label.slice(1)
		: label;
}

/** The line under a meter. `null` when there is nothing worth saying. */
export function meterCaption(
	key: LimitKey | string,
	meter: MeterState,
	planName: PlanId | string,
): string | null {
	const plan = planLabel(planName);
	const unit = units(key);
	switch (meter.tone) {
		case "unlimited":
			return `Unlimited ${unit.plural} on ${plan}.`;
		case "ok":
			return meter.remaining === null
				? null
				: `${countNoun(key, meter.remaining)} left on ${plan}.`;
		case "warning":
			return meter.remaining === null
				? null
				: `Only ${countNoun(key, meter.remaining)} left on ${plan}.`;
		case "limit":
			return `At ${plan}'s limit. ${capitalize(blockedSubject(key))} are blocked; everything you have stays.`;
		case "over":
			return `${formatCount(meter.overBy)} over ${plan}'s limit of ${formatCount(meter.limit ?? 0)}. ${STAYS} ${capitalize(blockedSubject(key))} are blocked.`;
	}
}

/** "Includes 2 pending invites." — pending invites count toward the member cap. */
export function pendingInvitesNote(pending: number): string | null {
	if (pending <= 0) return null;
	return `Includes ${formatCount(pending)} pending ${pending === 1 ? "invite" : "invites"}.`;
}

function joinList(parts: string[]): string {
	if (parts.length <= 1) return parts.join("");
	return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * One or two sentences for the plan card: who covers the plan when it is
 * complimentary, then what the plan includes.
 */
export function planSummaryCopy(input: {
	plan: PlanId | string;
	isComplimentary?: boolean;
	/** Formatted end date of a complimentary plan, if it has one. */
	complimentaryUntil?: string | null;
	limits?: LimitCellMap | null;
}): string {
	const plan = planLabel(input.plan);
	const sentences: string[] = [];
	if (input.isComplimentary) {
		sentences.push(
			input.complimentaryUntil
				? `Proyekto covers this workspace's ${plan} plan until ${input.complimentaryUntil}.`
				: `Proyekto covers this workspace's ${plan} plan.`,
		);
	}
	if (input.limits) {
		const keys = ["members", "projects", "teams"] as const;
		const values = keys.map((key) => {
			const cell = input.limits?.[key];
			return cell && cell.kind !== "feature" ? cell.value : null;
		});
		const list = values.every((value) => value === null)
			? "unlimited members, projects and teams"
			: joinList(
					keys.map((key, i) => {
						const value = values[i];
						return value === null
							? `unlimited ${units(key).plural}`
							: countNoun(key, value);
					}),
				);
		sentences.push(`${plan} includes ${list}.`);
	}
	return sentences.join(" ");
}

export type UpgradeCta =
	| { kind: "upgrade"; label: string }
	| { kind: "ask_owner"; label: string }
	| { kind: "none"; label: "" };

/**
 * The call to action beside a limit. Only owners can change the plan
 * (checkout is owner-only), so everyone else is pointed at one. A
 * complimentary workspace, or one already on the top plan, gets nothing.
 */
export function upgradeCta(input: {
	role: ViewerRole;
	isComplimentary?: boolean;
	upgradePlanName: PlanId | string | null | undefined;
}): UpgradeCta {
	if (input.isComplimentary || !input.upgradePlanName) {
		return { kind: "none", label: "" };
	}
	if (input.role === "owner") {
		return {
			kind: "upgrade",
			label: `Upgrade to ${planLabel(input.upgradePlanName)}`,
		};
	}
	return { kind: "ask_owner", label: "Ask a workspace owner to upgrade." };
}

/** "Included" / "Available on Pro" / "Contact sales" for a feature row. */
export function featureAvailabilityCopy(
	enabled: boolean,
	availableOn: PlanId | string | null | undefined,
): string {
	if (enabled) return "Included";
	return availableOn
		? `Available on ${planLabel(availableOn)}`
		: "Contact sales";
}

/**
 * The activity-history note. Retention hides older activity from view; it
 * never removes it, and the copy has to say so.
 */
export function retentionCopy(
	days: number | null,
	planName: PlanId | string,
): string {
	const plan = planLabel(planName);
	if (days === null) return `${plan} shows your full activity history.`;
	return `${plan} shows the last ${countNoun("activity_retention_days", days)} of activity. Older activity is kept and comes back on a plan with longer history.`;
}

/** Short heading for a blocked write: "Project limit reached", "Available on Pro". */
export function planLimitTitle(info: PlanLimitInfo): string {
	if (info.kind === "feature") {
		return info.upgradePlan
			? `Available on ${planLabel(info.upgradePlan)}`
			: `Not included in ${planLabel(info.plan)}`;
	}
	if (info.limitKey === "roadmap_nodes_per_roadmap") {
		return "Roadmap node limit reached";
	}
	return `${capitalize(units(info.limitKey).singular)} limit reached`;
}

export interface PlanLimitToastCopy {
	message: string;
	/** Owners go to billing; other members to the usage page; non-members nowhere. */
	action: "upgrade" | "view_usage" | null;
	actionLabel: string | null;
}

/**
 * The prompt for a blocked write when the server sent no message of its own
 * (it normally does). `role` is the viewer's role in the blocked workspace,
 * `null` when they are not a member — an invitee accepting an invite.
 */
export function planLimitToastCopy(
	info: PlanLimitInfo,
	role: ViewerRole,
): PlanLimitToastCopy {
	const plan = planLabel(info.plan);
	const upgrade = info.upgradePlan ? planLabel(info.upgradePlan) : null;
	const sentences: string[] = [];

	if (info.kind === "feature") {
		sentences.push(
			`The ${plan} plan doesn't include ${inSentence(info.label)}.`,
		);
		if (upgrade) sentences.push(`It's available on ${upgrade} and above.`);
	} else {
		const subject =
			info.limitKey === "roadmap_nodes_per_roadmap"
				? "This roadmap"
				: "This workspace";
		sentences.push(
			info.limit === null
				? `${subject} has reached a limit of its ${plan} plan.`
				: `${subject} has reached the ${formatCount(info.limit)}-${units(info.limitKey).singular} limit of its ${plan} plan.`,
		);
		sentences.push(STAYS);
	}

	if (info.context === "accept" || !role) {
		sentences.push(
			info.context === "accept"
				? "Ask a workspace owner to upgrade, then accept this invite again."
				: "Ask a workspace owner to upgrade.",
		);
	} else if (role === "owner") {
		sentences.push(
			upgrade
				? `Upgrade to ${upgrade} to ${info.kind === "feature" ? "turn it on" : "add more"}.`
				: "Contact sales about a higher limit.",
		);
	} else {
		sentences.push("Ask a workspace owner to upgrade.");
	}

	const action =
		role === "owner" && upgrade ? "upgrade" : role ? "view_usage" : null;
	return {
		message: sentences.join(" "),
		action,
		actionLabel:
			action === "upgrade"
				? "Upgrade"
				: action === "view_usage"
					? "View usage"
					: null,
	};
}

/**
 * The note in the invite dialog when the member cap bounds a batch. `null`
 * when the cap is unlimited.
 */
export function inviteCapNote(
	remaining: number | null,
	planName: PlanId | string,
): string | null {
	if (remaining === null) return null;
	const plan = planLabel(planName);
	if (remaining <= 0) {
		return `${plan} has no member spots left, so this invite can't be sent. Pending invites count toward the limit.`;
	}
	return `${plan} has room for ${formatCount(remaining)} more ${remaining === 1 ? "member" : "members"}. Pending invites count toward the limit.`;
}
