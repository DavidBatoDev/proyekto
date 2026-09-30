import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { teamOwnerTemplateLabel } from "@/lib/contract-templates";
import type { Contract } from "@/services/contract.service";
import { contractHistoryService } from "@/services/contract-history.service";

/**
 * Which paper a draft is issued under: the per-kind standard agreement, or
 * the Team Owner Agreement between the author's team and the counterparty.
 * Author only, draft only; replacing the clauses discards edits to them.
 */
export function ContractTemplatePicker({ contract }: { contract: Contract }) {
	const qc = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const current = contract.template_key?.startsWith("team_owner")
		? "team_owner"
		: "standard";
	const mutation = useMutation({
		mutationFn: (template: "standard" | "team_owner") =>
			contractHistoryService.applyTemplate(contract.id, template),
		onSuccess: (updated) => {
			qc.setQueryData(["contract", contract.id], (existing: unknown) =>
				existing ? { ...(existing as object), ...updated } : updated,
			);
			void qc.invalidateQueries({ queryKey: ["contract", contract.id] });
			toast.success("Template applied");
		},
		onError: (error: Error) => toast.error(error.message),
	});
	const choose = async (template: "standard" | "team_owner") => {
		if (template === current) return;
		const ok = await confirm({
			title: "Replace the agreement text?",
			message:
				"The clauses are replaced with the template's. Changes you made to the clauses are lost; the commercial terms stay.",
			confirmLabel: "Replace clauses",
			tone: "danger",
		});
		if (ok) mutation.mutate(template);
	};
	return (
		<div className="mb-3 rounded-lg border border-border p-3">
			<p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
				Template
			</p>
			<div className="mt-2 flex flex-wrap gap-1.5">
				{(
					[
						["standard", "Standard agreement"],
						["team_owner", "Team Owner Agreement"],
					] as const
				).map(([value, label]) => (
					<button
						type="button"
						key={value}
						disabled={mutation.isPending}
						onClick={() => void choose(value)}
						className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold ${
							current === value
								? "bg-foreground text-background"
								: "bg-muted text-muted-foreground hover:text-foreground"
						}`}
					>
						{mutation.isPending && mutation.variables === value && (
							<Loader2 className="h-3 w-3 animate-spin" />
						)}
						{label}
					</button>
				))}
			</div>
			<p className="mt-2 text-[11px] text-muted-foreground">
				{current === "team_owner"
					? `${teamOwnerTemplateLabel(contract.template_key) ?? "Team Owner Agreement"}: between your team and the other party. You sign on behalf of the team you chose under Parties.`
					: "The Team Owner Agreement makes this a contract between your team and the other party, worded for a talent, consultant or client counterparty."}
			</p>
		</div>
	);
}
