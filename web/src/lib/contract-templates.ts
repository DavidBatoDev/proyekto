/**
 * The label on every surface that shows an adopted (external) agreement.
 * The date is the one both parties attest they signed on.
 */
export function recordedAgreementLabel(
	agreedAt: string | null | undefined,
): string {
	if (!agreedAt) return "Recorded agreement — signed outside Proyekto";
	const parsed = new Date(`${agreedAt.slice(0, 10)}T00:00:00Z`);
	const date = Number.isNaN(parsed.getTime())
		? agreedAt
		: parsed.toLocaleDateString("en-US", {
				day: "numeric",
				month: "long",
				year: "numeric",
				timeZone: "UTC",
			});
	return `Recorded agreement — signed outside Proyekto on ${date}`;
}

/** What the Team Owner Agreement is called for each counterparty. */
export function teamOwnerTemplateLabel(
	templateKey: string | null | undefined,
): string | null {
	switch (templateKey) {
		case "team_owner:talent":
			return "Team Contractor Agreement";
		case "team_owner:consultant":
			return "Team Consulting Agreement";
		case "team_owner:client":
			return "Team Services Agreement";
		default:
			return null;
	}
}
