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
