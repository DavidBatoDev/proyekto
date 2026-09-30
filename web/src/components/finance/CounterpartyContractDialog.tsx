import { useMutation } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import { type Contract, contractService } from "@/services/contract.service";

/**
 * Two-way contract authoring: a client or talent drafts a contract with a
 * consultant. The caller takes their own seat and names the consultant by
 * exact email; the draft stays private to them until they send it.
 */
export function CounterpartyContractDialog({
	open,
	onClose,
	onCreated,
}: {
	open: boolean;
	onClose: () => void;
	onCreated: (contract: Contract) => void;
}) {
	const [capacity, setCapacity] = useState<"client" | "talent">("client");
	const [email, setEmail] = useState("");
	const [consultant, setConsultant] = useState<{
		id: string;
		display_name: string | null;
		email: string | null;
	} | null>(null);
	useEffect(() => {
		if (!open) return;
		setCapacity("client");
		setEmail("");
		setConsultant(null);
	}, [open]);
	const resolveMutation = useMutation({
		mutationFn: (value: string) => contractService.resolveCounterparty(value),
		onSuccess: setConsultant,
	});
	const createMutation = useMutation({
		mutationFn: () =>
			contractService.create({
				author_capacity: capacity,
				relationship_kind:
					capacity === "talent" ? "talent_services" : "client_services",
				scope_mode: "flexible",
				counterparty_user_id: consultant?.id,
			}),
		onSuccess: onCreated,
	});
	if (!open) return null;
	return (
		<ModalPortal>
			<div className="fixed inset-0 z-80 flex items-center justify-center p-4">
				<button
					type="button"
					aria-label="Close"
					onClick={onClose}
					className="absolute inset-0 bg-foreground/30 backdrop-blur-[1px]"
				/>
				<div
					role="dialog"
					aria-modal="true"
					aria-labelledby="counterparty-contract-title"
					className="relative w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl"
				>
					<div className="flex items-start justify-between gap-4">
						<div>
							<h2
								id="counterparty-contract-title"
								className="text-base font-semibold text-foreground"
							>
								Draft a contract
							</h2>
							<p className="mt-1 text-xs leading-5 text-muted-foreground">
								You propose the terms; the consultant reviews, edits and signs.
								Nobody else sees the draft until you send it.
							</p>
						</div>
						<button
							type="button"
							onClick={onClose}
							className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
							aria-label="Close"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
					<div className="mt-4 grid grid-cols-2 gap-2">
						{(
							[
								["client", "I am hiring a consultant"],
								["talent", "I am working for a consultant"],
							] as const
						).map(([value, label]) => (
							<button
								type="button"
								key={value}
								onClick={() => setCapacity(value)}
								className={`rounded-lg border px-3 py-2 text-left text-xs font-medium ${
									capacity === value
										? "border-primary bg-primary/10 text-foreground"
										: "border-border text-muted-foreground hover:bg-muted"
								}`}
							>
								{label}
							</button>
						))}
					</div>
					<div className="mt-4 rounded-lg border border-border p-3">
						<p className="text-xs font-medium text-foreground">
							Consultant account
						</p>
						<p className="mt-1 text-[11px] text-muted-foreground">
							Their exact Proyekto email.{" "}
							{capacity === "talent"
								? "They must be a verified consultant."
								: "They must be verified before the contract can be signed."}
						</p>
						<div className="mt-2 flex gap-2">
							<input
								value={email}
								onChange={(event) => {
									setEmail(event.target.value);
									setConsultant(null);
								}}
								placeholder="consultant@example.com"
								className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"
							/>
							<button
								type="button"
								disabled={!email.trim() || resolveMutation.isPending}
								onClick={() => resolveMutation.mutate(email)}
								className="rounded-md bg-muted px-2.5 text-xs font-medium text-foreground disabled:opacity-50"
							>
								{resolveMutation.isPending ? "Checking…" : "Confirm"}
							</button>
						</div>
						{consultant && (
							<p className="mt-2 text-xs font-medium text-success-foreground">
								{consultant.display_name || consultant.email} confirmed
							</p>
						)}
						{resolveMutation.isError && (
							<p className="mt-2 text-xs text-destructive">
								{resolveMutation.error.message}
							</p>
						)}
					</div>
					{createMutation.isError && (
						<p className="mt-3 text-xs text-destructive">
							{createMutation.error.message}
						</p>
					)}
					<div className="mt-4 flex justify-end gap-2">
						<button
							type="button"
							onClick={onClose}
							className="h-9 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							Cancel
						</button>
						<button
							type="button"
							disabled={!consultant || createMutation.isPending}
							onClick={() => createMutation.mutate()}
							className="app-cta inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
						>
							{createMutation.isPending && (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							)}
							Create draft
						</button>
					</div>
				</div>
			</div>
		</ModalPortal>
	);
}
