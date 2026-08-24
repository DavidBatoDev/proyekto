import { formatCurrency } from "@/lib/currency";
import type {
	Engagement,
	EngagementTimeRate,
	EngagementTimeSettings,
} from "@/services/engagement.service";

const RATE_UNIT_SUFFIX: Record<string, string> = {
	hour: "/hr",
	month: "/mo",
	fixed: " fixed",
};

export function describeRate(rate: EngagementTimeRate): string {
	const amount = formatCurrency(rate.amount, rate.currency ?? "USD");
	return `${amount}${RATE_UNIT_SUFFIX[rate.unit] ?? ""}`;
}

export function describeScope(engagement: Engagement): string {
	const active = engagement.project_links.filter(
		(link) => link.status !== "ended",
	);
	if (engagement.scope_mode === "flexible" && active.length === 0) {
		return "Flexible · no projects placed yet";
	}
	if (active.length === 0) return "No linked project";
	if (active.length === 1) return active[0].project_title_snapshot;
	return `${active.length} projects`;
}

export function describeRelationship(engagement: Engagement): string {
	const name =
		engagement.counterparty?.display_name_snapshot ??
		engagement.counterparty?.email_snapshot ??
		"Counterparty removed";
	return engagement.viewer_position === "hirer"
		? `You hired ${name}`
		: `${name} hired you`;
}

const TRACKING_COPY: Record<string, string> = {
	disabled: "Time tracking off",
	optional: "Time tracking optional",
	required: "Time tracking required",
};

const APPROVAL_COPY: Record<string, string> = {
	none: "No timesheet approval",
	provider_submit_hirer_approve: "Provider submits, hirer approves",
};

const CLIENT_DETAIL_COPY: Record<string, string> = {
	none: "Client sees no hours",
	summary: "Client sees summarised hours",
	detailed: "Client sees detailed hours",
};

/**
 * The signed time policy in plain English.
 *
 * These four columns drive what a worker is allowed to log and what a client is
 * shown on an invoice, and every one of them was stored but never rendered
 * anywhere in the app.
 */
export function describeTimePolicy(settings: EngagementTimeSettings): string[] {
	const lines = [
		TRACKING_COPY[settings.tracking_mode] ?? settings.tracking_mode,
		APPROVAL_COPY[settings.approval_mode] ?? settings.approval_mode,
		CLIENT_DETAIL_COPY[settings.client_hours_detail_level] ??
			settings.client_hours_detail_level,
	];
	if (settings.rounding_minutes > 0) {
		lines.push(`Rounded to ${settings.rounding_minutes} min`);
	}
	if (settings.weekly_limit_minutes) {
		lines.push(`Capped at ${settings.weekly_limit_minutes / 60} h/week`);
	}
	lines.push(
		settings.allow_manual_entries
			? "Manual entries allowed"
			: "Timer entries only",
	);
	return lines;
}
