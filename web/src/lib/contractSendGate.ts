import type { Contract } from "@/services/contract.service";

/**
 * Why a draft cannot be sent yet, or null when it can. A contract drafted by
 * the client or talent waits for the named consultant's vetting; the server
 * refuses the send with the same reason.
 */
export function contractSendBlockedReason(
	contract: Pick<
		Contract,
		"created_by" | "consultant_user_id" | "consultant_verification"
	>,
): string | null {
	const counterpartyAuthored =
		Boolean(contract.created_by) &&
		contract.created_by !== contract.consultant_user_id;
	const verification = contract.consultant_verification;
	if (!counterpartyAuthored || !verification || verification.verified) {
		return null;
	}
	return `Waiting for ${verification.name}'s verification`;
}

export type SendReadinessFields = Pick<
	Contract,
	| "service_start_date"
	| "term_count"
	| "term_unit"
	| "service_end_date"
	| "billing_mode"
	| "fixed_fee"
	| "recurring_fee"
	| "client_hourly_rate"
>;

/**
 * What a draft still needs before it can be sent: whatever signing needs.
 * Mirrors backend contract-send-readiness.ts, which refuses the send with the
 * same list. Empty = ready.
 */
export function contractMissingForSend(
	contract: SendReadinessFields,
): string[] {
	const missing: string[] = [];
	if (!contract.service_start_date) missing.push("Service start date");
	if (!contract.term_count || !contract.term_unit || !contract.service_end_date)
		missing.push("Term (how long the service runs)");
	if (contract.billing_mode === "fixed" && contract.fixed_fee == null)
		missing.push("Fixed contract amount");
	if (
		(contract.billing_mode === "retainer" ||
			contract.billing_mode === "hybrid") &&
		contract.recurring_fee == null
	)
		missing.push("Monthly contract rate");
	if (
		(contract.billing_mode === "time_based" ||
			contract.billing_mode === "hybrid") &&
		contract.client_hourly_rate == null
	)
		missing.push("Hourly contract rate");
	return missing;
}
