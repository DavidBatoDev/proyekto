import { Info } from "lucide-react";
import { useBillingSummaryQuery } from "@/hooks/useBilling";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import { type SeatChangeReason, seatChangeCopy } from "@/lib/billingCopy";
import type { Workspace } from "@/services/workspaces.service";

interface SeatChangeNoticeProps {
	/** Optional: falls back to the workspace in the URL, which is where every
	 *  seat-changing surface lives. */
	workspace?: Workspace;
	reason: SeatChangeReason;
}

/**
 * What a seat change will do to the bill, shown BEFORE the click.
 *
 * It renders at both ends of the seat lifecycle — inviting and removing —
 * because the two are asymmetric in a way people get wrong: a seat is consumed
 * when someone ACCEPTS, so an owner who invites five people sees no charge and
 * then watches the bill move days later when other people click a link.
 *
 * Silent for plain members, who cannot read billing at all, and silent while
 * the summary is loading rather than guessing at the answer.
 */
export function SeatChangeNotice({
	workspace: given,
	reason,
}: SeatChangeNoticeProps) {
	const current = useCurrentWorkspace();
	const workspace = given ?? current.workspace ?? null;
	const canManage =
		workspace?.my_role === "owner" || workspace?.my_role === "admin";
	const { data: summary } = useBillingSummaryQuery(
		canManage && workspace ? workspace.id : null,
	);

	if (!workspace || !canManage || !summary) return null;

	const lines = seatChangeCopy({
		plan: summary.plan,
		seatDeltaEffect: summary.seat_delta_effect,
		status: summary.status,
		reason,
		nextInvoiceDate: formatDate(summary.next_invoice?.date ?? null),
		isOwner: workspace.my_role === "owner",
		// A granted plan with no subscription behind it bills nobody. With a
		// live subscription the seats still move that bill, so the normal copy
		// stands.
		isComplimentary:
			summary.plan_source === "complimentary" &&
			summary.has_live_subscription !== true,
	});

	return (
		<div className="mt-4 flex gap-3 rounded-xl border border-border bg-muted/40 p-3 text-left">
			<Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
			<div className="space-y-1 text-xs text-muted-foreground">
				{lines.map((line) => (
					<p key={line}>{line}</p>
				))}
			</div>
		</div>
	);
}

function formatDate(iso: string | null): string | null {
	if (!iso) return null;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	return date.toLocaleDateString(undefined, {
		day: "numeric",
		month: "long",
		year: "numeric",
	});
}
