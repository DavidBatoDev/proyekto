/**
 * Whether an invoice has a client it can be issued/sent to. Mirrors the backend
 * `assertInvoiceHasClient` guard so the UI can disable the Issue button before
 * the request round-trips. Accepts any of a linked client account, a client
 * email snapshotted on the invoice, or a real client on the project.
 */
export function invoiceHasClient(opts: {
	recipientUserId?: string | null;
	billToEmail?: string | null;
	projectClientId?: string | null;
	projectConsultantId?: string | null;
}): boolean {
	if (opts.recipientUserId) return true;
	if (opts.billToEmail?.trim()) return true;
	if (
		opts.projectClientId &&
		opts.projectClientId !== opts.projectConsultantId
	) {
		return true;
	}
	return false;
}

export const NO_CLIENT_HINT =
	"Add a client to the project (or the contract's client details) before issuing.";
