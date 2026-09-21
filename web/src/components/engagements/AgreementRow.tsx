import { ChevronRight, FileSignature } from "lucide-react";
import { FinanceStatusBadge } from "@/components/finance/portfolio/FinancePrimitives";
import type { EngagementAgreement } from "@/services/engagement.service";

/**
 * One contract seat of the viewer's, as a row.
 *
 * The row opens the contract document: reads are position-based on the
 * server, and the editor's signing section already resolves the viewer's own
 * seat, so every party — client and talent included — can review the paper
 * they signed. A `sent` contract opens straight on the signatures section,
 * because for the seat that has not signed yet that is the whole errand.
 */
export function AgreementRow({
	agreement,
	onOpen,
}: {
	agreement: EngagementAgreement;
	onOpen: (contractId: string, section?: "signatures") => void;
}) {
	const signed = agreement.signed_at
		? new Date(agreement.signed_at).toLocaleDateString(undefined, {
				month: "short",
				day: "numeric",
				year: "numeric",
			})
		: null;
	const awaitingMe = agreement.status === "sent" && !agreement.signed_at;
	return (
		<button
			type="button"
			onClick={() =>
				onOpen(
					agreement.contract_id,
					agreement.status === "sent" ? "signatures" : undefined,
				)
			}
			className="group flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/40 md:px-5 md:py-4"
		>
			<span className="flex min-w-0 items-center gap-3">
				<span
					className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
						awaitingMe
							? "bg-warning/10 text-warning-foreground"
							: "bg-muted text-muted-foreground"
					}`}
				>
					<FileSignature className="h-5 w-5" />
				</span>
				<span className="min-w-0">
					<span className="block truncate font-semibold text-foreground">
						{agreementTitle(agreement)}
					</span>
					<span className="mt-1 block truncate text-xs text-muted-foreground">
						{agreement.relationship_kind === "client_services"
							? "Client contract"
							: "Talent contract"}
						{agreement.project_title ? ` · ${agreement.project_title}` : ""}
						{awaitingMe
							? " · awaiting your signature"
							: signed
								? ` · signed ${signed}`
								: ""}
						{agreement.client_hourly_rate != null
							? ` · ${agreement.client_hourly_rate.toLocaleString()} ${agreement.currency}/h`
							: ""}
					</span>
				</span>
			</span>
			<span className="flex shrink-0 items-center gap-3">
				{awaitingMe && (
					<span className="hidden text-xs font-semibold text-warning-foreground sm:inline">
						Review &amp; sign
					</span>
				)}
				<FinanceStatusBadge status={agreement.status} />
				<ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
			</span>
		</button>
	);
}

/**
 * `contract_number` is null on contracts the API created without one, and the
 * counterparty snapshot can be absent too — never render either gap as the
 * literal string "null".
 */
export function agreementTitle(agreement: EngagementAgreement): string {
	return agreement.counterparty_name
		? agreement.contract_number
			? `${agreement.contract_number} · with ${agreement.counterparty_name}`
			: `With ${agreement.counterparty_name}`
		: (agreement.contract_number ?? "Contract");
}
