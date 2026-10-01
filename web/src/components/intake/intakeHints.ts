import type { IntakeRelationship } from "@/services/intake.service";

/** "Waiting for <name> to join", plus why it could not record if it tried. */
export function heldAgreementLabel(held: {
	email: string;
	name: string | null;
	last_error?: string | null;
}): string {
	const who = held.name ?? held.email;
	return held.last_error
		? `${who} joined, but the agreement could not be recorded: ${held.last_error}`
		: `Waiting for ${who} to join. The agreement is recorded and sent to them to confirm when they accept the invite sent to ${held.email}.`;
}

/**
 * The paper names the importer differently from their team (a trading name):
 * say so and suggest the team name the records are created under.
 */
export function importerSideHint(
	check: IntakeRelationship["party_check"],
): string | null {
	if (!check || check.matches || !check.read_name) return null;
	return check.team_name
		? `These documents name you "${check.read_name}", not your team "${check.team_name}". They are recorded under ${check.team_name}. If "${check.read_name}" is the other party, enter their name above instead.`
		: `These documents name you "${check.read_name}". If that is the other party, enter their name above instead.`;
}
