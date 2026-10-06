// The one helper the team money pages still share (TeamRatesSection's member
// avatars). The rest of this module went with the old team-time pages: live
// clocks are in `components/time/timer/liveDuration.ts`, durations and money
// lines in `lib/timeFormat.ts`.

export function initialsFromName(name?: string | null) {
	const base = (name || "?").trim();
	if (!base) return "?";
	// Words with no letter or digit are skipped, and each initial is the first
	// such character in its word — otherwise a project called "PRD - Proyekto"
	// initials to "P-".
	const words = base.split(/\s+/).filter((part) => /[\p{L}\p{N}]/u.test(part));
	return (words.length > 0 ? words : [base])
		.map((part) => part.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
		.join("")
		.slice(0, 2)
		.toUpperCase();
}
