import { useMutation } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import type { Contract } from "@/services/contract.service";
import { contractService } from "@/services/contract.service";
import { contractHistoryService } from "@/services/contract-history.service";
import { financeImportsService } from "@/services/financeImports.service";

/**
 * Record an agreement that was signed outside Proyekto (off-platform
 * adoption). Not a new signature: the uploaded document stays the legal
 * authority, and the record only activates once BOTH parties attest that it
 * matches what they signed.
 */
export function RecordAgreementDialog({
	open,
	projects,
	onClose,
	onRecorded,
}: {
	open: boolean;
	projects: Array<{ id: string; title: string }>;
	onClose: () => void;
	onRecorded: (contract: Contract) => void;
}) {
	const [projectId, setProjectId] = useState("");
	const [relationshipKind, setRelationshipKind] = useState<
		"client_services" | "talent_services"
	>("client_services");
	const [email, setEmail] = useState("");
	const [counterparty, setCounterparty] = useState<{
		id: string;
		display_name: string | null;
		email: string | null;
	} | null>(null);
	const [agreedAt, setAgreedAt] = useState("");
	const [startDate, setStartDate] = useState("");
	const [termMonths, setTermMonths] = useState("12");
	const [monthlyRate, setMonthlyRate] = useState("");
	const [currency, setCurrency] = useState("USD");
	const [file, setFile] = useState<File | null>(null);
	useEffect(() => {
		if (!open) return;
		setProjectId("");
		setEmail("");
		setCounterparty(null);
		setAgreedAt("");
		setStartDate("");
		setFile(null);
	}, [open]);

	const resolve = useMutation({
		mutationFn: (value: string) => contractService.resolveCounterparty(value),
		onSuccess: setCounterparty,
	});
	const record = useMutation({
		mutationFn: async () => {
			if (!file || !counterparty) throw new Error("Missing details");
			const document = await financeImportsService.upload(
				projectId,
				"contract",
				file,
			);
			return contractHistoryService.recordExternal({
				project_id: projectId,
				counterparty_user_id: counterparty.id,
				relationship_kind: relationshipKind,
				external_agreed_at: agreedAt,
				external_document_id: document.id,
				service_start_date: startDate || agreedAt,
				term_count: Number(termMonths) || 12,
				term_unit: "month",
				currency,
				...(monthlyRate
					? {
							billing_mode: "retainer" as const,
							recurring_fee: Number(monthlyRate),
						}
					: {}),
			});
		},
		onSuccess: onRecorded,
	});
	if (!open) return null;
	const today = new Date().toISOString().slice(0, 10);
	const valid =
		projectId &&
		counterparty &&
		agreedAt &&
		agreedAt <= today &&
		(!startDate || startDate >= agreedAt) &&
		file;

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
					aria-labelledby="record-agreement-title"
					className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl"
				>
					<div className="flex items-start justify-between gap-4">
						<div>
							<h2
								id="record-agreement-title"
								className="text-base font-semibold text-foreground"
							>
								Record an existing agreement
							</h2>
							<p className="mt-1 text-xs leading-5 text-muted-foreground">
								For work already running under a paper agreement. Upload what
								was signed and transcribe its terms; the other party confirms
								the record matches. Nothing activates on your word alone.
							</p>
						</div>
						<button
							type="button"
							onClick={onClose}
							aria-label="Close"
							className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							<X className="h-4 w-4" />
						</button>
					</div>

					<div className="mt-4 space-y-3 text-xs">
						<label className="block">
							<span className="font-medium text-foreground">Project</span>
							<select
								value={projectId}
								onChange={(event) => setProjectId(event.target.value)}
								className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
							>
								<option value="">Choose a project…</option>
								{projects.map((project) => (
									<option key={project.id} value={project.id}>
										{project.title}
									</option>
								))}
							</select>
						</label>
						<div className="grid grid-cols-2 gap-2">
							{(
								[
									["client_services", "With my client"],
									["talent_services", "With my talent"],
								] as const
							).map(([value, label]) => (
								<button
									type="button"
									key={value}
									onClick={() => setRelationshipKind(value)}
									className={`rounded-lg border px-3 py-2 text-left font-medium ${
										relationshipKind === value
											? "border-primary bg-primary/10 text-foreground"
											: "border-border text-muted-foreground hover:bg-muted"
									}`}
								>
									{label}
								</button>
							))}
						</div>
						<div>
							<span className="font-medium text-foreground">
								The other party's Proyekto email
							</span>
							<div className="mt-1 flex gap-2">
								<input
									value={email}
									onChange={(event) => {
										setEmail(event.target.value);
										setCounterparty(null);
									}}
									placeholder="person@example.com"
									className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2"
								/>
								<button
									type="button"
									disabled={!email.trim() || resolve.isPending}
									onClick={() => resolve.mutate(email)}
									className="rounded-md bg-muted px-2.5 font-medium disabled:opacity-50"
								>
									{resolve.isPending ? "Checking…" : "Confirm"}
								</button>
							</div>
							{counterparty && (
								<p className="mt-1 font-medium text-success-foreground">
									{counterparty.display_name || counterparty.email} confirmed
								</p>
							)}
							{resolve.isError && (
								<p className="mt-1 text-destructive">{resolve.error.message}</p>
							)}
						</div>
						<div className="grid grid-cols-2 gap-2">
							<label className="block">
								<span className="font-medium text-foreground">
									Date it was signed
								</span>
								<input
									type="date"
									max={today}
									value={agreedAt}
									onChange={(event) => setAgreedAt(event.target.value)}
									className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
								/>
							</label>
							<label className="block">
								<span className="font-medium text-foreground">
									Service start
								</span>
								<input
									type="date"
									min={agreedAt || undefined}
									value={startDate}
									onChange={(event) => setStartDate(event.target.value)}
									className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
								/>
							</label>
							<label className="block">
								<span className="font-medium text-foreground">
									Term (months)
								</span>
								<input
									inputMode="numeric"
									value={termMonths}
									onChange={(event) => setTermMonths(event.target.value)}
									className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
								/>
							</label>
							<label className="block">
								<span className="font-medium text-foreground">
									Monthly rate ({currency})
								</span>
								<div className="mt-1 flex gap-1">
									<input
										value={currency}
										onChange={(event) =>
											setCurrency(event.target.value.toUpperCase().slice(0, 3))
										}
										className="h-9 w-14 rounded-md border border-input bg-background px-2"
									/>
									<input
										inputMode="decimal"
										value={monthlyRate}
										onChange={(event) => setMonthlyRate(event.target.value)}
										placeholder="optional"
										className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2"
									/>
								</div>
							</label>
						</div>
						<label className="block">
							<span className="font-medium text-foreground">
								The signed document (PDF or photo)
							</span>
							<input
								type="file"
								accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
								onChange={(event) => setFile(event.target.files?.[0] ?? null)}
								className="mt-1 block w-full text-xs"
							/>
						</label>
						<p className="text-[11px] text-muted-foreground">
							You can fill in the rest of the terms and the clauses on the next
							page before sending it for confirmation.
						</p>
						{record.isError && (
							<p className="text-destructive">{record.error.message}</p>
						)}
					</div>
					<div className="mt-4 flex justify-end gap-2">
						<button
							type="button"
							onClick={onClose}
							className="h-9 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
						>
							Cancel
						</button>
						<button
							type="button"
							disabled={!valid || record.isPending}
							onClick={() => record.mutate()}
							className="app-cta inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
						>
							{record.isPending && (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							)}
							Record agreement
						</button>
					</div>
				</div>
			</div>
		</ModalPortal>
	);
}
