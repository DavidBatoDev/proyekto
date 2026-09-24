import { Link } from "@tanstack/react-router";

/** "Open time settings" — the switches behind time logs, rates, and payouts. */
export function TimeSettingsLink({ teamId }: { teamId: string }) {
	return (
		<Link
			to="/teams/$teamId/settings/time"
			params={{ teamId }}
			className="inline-block rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
		>
			Open time settings
		</Link>
	);
}
