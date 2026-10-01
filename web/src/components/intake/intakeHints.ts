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

/**
 * The one-click fix for the hint above: remember the name the paper uses as
 * one of the team's trading names, so intake treats it as the team from now
 * on. Null when there is nothing to save or no team to save it to.
 */
export function tradingNameAction(
	check: IntakeRelationship["party_check"],
): { teamId: string; name: string; label: string } | null {
	if (!check || check.matches || !check.read_name) return null;
	if (!check.team_id || !check.team_name) return null;
	return {
		teamId: check.team_id,
		name: check.read_name,
		label: `Save "${check.read_name}" as a trading name of ${check.team_name}`,
	};
}

/** Adds `name` to a team's trading names unless it is already there (any case). */
export function withTradingName(existing: string[], name: string): string[] {
	const trimmed = name.replace(/\s+/g, " ").trim();
	if (!trimmed) return existing;
	const key = trimmed.toLowerCase();
	return existing.some((item) => item.trim().toLowerCase() === key)
		? existing
		: [...existing, trimmed];
}

type CurrencyQuestion = NonNullable<IntakeRelationship["currency_question"]>;

/** "Invoices are in AUD; project is USD." */
export function currencyQuestionText(
	question: CurrencyQuestion,
	invoicesOnly: boolean,
): string {
	const what = invoicesOnly ? "Invoices are" : "These documents are";
	const docs = question.document_currencies.join(" and ");
	return question.project_is_new
		? `${what} in ${docs}; a new project defaults to ${question.project_currency}. Which currency should the new project use?`
		: `${what} in ${docs}; the project is in ${question.project_currency}. Set the project currency to ${docs}, or keep ${question.project_currency}?`;
}

/** The choices, the documents' currencies first and "keep" last. */
export function currencyOptions(
	question: CurrencyQuestion,
): Array<{ value: string; label: string }> {
	const foreign = question.document_currencies.filter(
		(code) => code !== question.project_currency,
	);
	return [
		...foreign.map((code) => ({
			value: code,
			label: question.project_is_new
				? `Create the project in ${code}`
				: `Set project currency to ${code}`,
		})),
		{
			value: question.project_currency,
			label: question.project_is_new
				? `Use ${question.project_currency} (the default)`
				: `Keep ${question.project_currency}`,
		},
	];
}
