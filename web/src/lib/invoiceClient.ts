/**
 * Whether an invoice names somebody it can be issued to. Mirrors the backend
 * `assertInvoiceHasClient` guard so the UI can disable the Issue button before
 * the request round-trips: either a linked recipient account or a bill-to email
 * snapshotted on the invoice.
 *
 * There used to be a third term, `projectHasClient`, fed by a `has_client` flag
 * the backend derived by looking for the project member whose access origin was
 * 'consultant' and asking whether the owner was somebody else. That let an
 * invoice be issued with no recipient named anywhere on it, on the strength of
 * a persona the execution layer had no business inferring — a project has
 * members with permissions, not a client and a consultant. An invoice must now
 * name its recipient.
 */
export function invoiceHasClient(opts: {
	recipientUserId?: string | null;
	billToEmail?: string | null;
}): boolean {
	if (opts.recipientUserId) return true;
	if (opts.billToEmail?.trim()) return true;
	return false;
}

export const NO_CLIENT_HINT =
	"This invoice has no recipient to send to. Link a recipient account, or fill in the bill-to details, before issuing.";
