import type { TimeLogStatus } from "@/services/team-time.service";
import { formatMoney } from "./time-utils";

/**
 * A single log's billable amount, colored by whether it counts as billable.
 *
 * Billable = approved + paid (emerald). Pending is provisional and shown muted,
 * since it is not yet billable. Rejected is non-billable — struck through.
 * Running or unrated logs have no amount to show ("—").
 */
export function BillableAmount({
	status,
	running,
	fee,
	currency,
}: {
	status: TimeLogStatus;
	running?: boolean;
	fee: number | null;
	currency: string;
}) {
	if (running || fee === null || fee <= 0)
		return <span className="text-slate-400">—</span>;
	const money = formatMoney(fee, currency);
	if (status === "approved" || status === "paid")
		return <span className="text-emerald-700">{money}</span>;
	if (status === "rejected")
		return (
			<span
				className="text-slate-400 line-through"
				title="Rejected — non-billable"
			>
				{money}
			</span>
		);
	return (
		<span className="text-slate-500" title="Pending — not yet billable">
			{money}
		</span>
	);
}
