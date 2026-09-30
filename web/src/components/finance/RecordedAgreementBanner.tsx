import { useMutation } from "@tanstack/react-query";
import { FileText, Loader2, Stamp } from "lucide-react";
import { useToast } from "@/hooks/useToast";
import { recordedAgreementLabel } from "@/lib/contract-templates";
import type { Contract } from "@/services/contract.service";
import { contractHistoryService } from "@/services/contract-history.service";

/**
 * The label every surface shows on an adopted agreement, so an attestation
 * can never be mistaken for a signature: the paper signed outside Proyekto is
 * the legal authority, and this is a record of it.
 */
export function RecordedAgreementBanner({ contract }: { contract: Contract }) {
	const toast = useToast();
	const evidence = useMutation({
		mutationFn: () => contractHistoryService.evidenceUrl(contract.id),
		onSuccess: (url) => window.open(url, "_blank", "noopener"),
		onError: (error: Error) => toast.error(error.message),
	});
	if (contract.execution_origin !== "external") return null;
	return (
		<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-sky-300/60 bg-sky-50 px-4 py-2 text-xs text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
			<span className="inline-flex items-center gap-1.5">
				<Stamp className="h-3.5 w-3.5" />
				<strong>{recordedAgreementLabel(contract.external_agreed_at)}</strong>
				<span className="hidden md:inline">
					· Both parties attest that this record matches the signed document.
				</span>
			</span>
			{contract.external_document_id && (
				<button
					type="button"
					onClick={() => evidence.mutate()}
					disabled={evidence.isPending}
					className="inline-flex items-center gap-1.5 rounded-md border border-sky-400/70 px-2.5 py-1 font-semibold hover:bg-sky-100 disabled:opacity-50 dark:hover:bg-sky-500/20"
				>
					{evidence.isPending ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : (
						<FileText className="h-3.5 w-3.5" />
					)}
					Signed document
				</button>
			)}
		</div>
	);
}
