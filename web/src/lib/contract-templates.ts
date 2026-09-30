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
