import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Download, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { CurrencySelect } from "@/components/common/CurrencySelect";
import { useToast } from "@/hooks/useToast";
import { invoiceHasClient, NO_CLIENT_HINT } from "@/lib/invoiceClient";
import { contractService } from "@/services/contract.service";
import {
	type HoursDetailLevel,
	type Invoice,
	invoiceService,
} from "@/services/invoice.service";
import { projectService } from "@/services/project.service";
import { ConfirmIssueInvoiceModal } from "./ConfirmIssueInvoiceModal";
import { InvoicePreview, type InvoicePreviewParty } from "./InvoicePreview";

interface LineDraft {
	key: string;
	description: string;
	quantity: string;
	unit_rate: string;
}

interface Props {
	projectId: string;
	/** Present when editing an existing draft; absent when creating. */
	invoiceId?: string;
}

function emptyLine(): LineDraft {
	return {
		key: crypto.randomUUID(),
		description: "",
		quantity: "1",
		unit_rate: "0",
	};
}

/**
 * Full-page create/edit invoice experience: an editable form on the left and a
 * live preview on the right that mirrors the generated PDF. Multi-line items, a
 * picker that pulls the contract's defined services, save-as-draft, issue, and
 * PDF download. Editing is allowed for drafts only (the backend rejects
 * paid/void, and issued invoices have already been sent).
 */
export function InvoiceBuilder({ projectId, invoiceId }: Props) {
	const navigate = useNavigate();
	const toast = useToast();
	const qc = useQueryClient();

	const projectQuery = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => projectService.get(projectId),
	});
	const contractsQuery = useQuery({
		queryKey: ["contracts", projectId],
		queryFn: () => contractService.listByProject(projectId),
	});
	const existingQuery = useQuery({
		queryKey: ["invoice", invoiceId],
		queryFn: () => invoiceService.get(invoiceId as string),
		enabled: Boolean(invoiceId),
	});

	// Prefer a live (signed/active) contract for party + service defaults.
	const contract = useMemo(() => {
		const all = contractsQuery.data ?? [];
		return (
			all.find((c) => c.status === "signed" || c.status === "active") ??
			all[0] ??
			null
		);
	}, [contractsQuery.data]);

	const existing = existingQuery.data;
	const projectCurrency = projectQuery.data?.currency ?? "USD";

	// ── form state, seeded once from the existing invoice / defaults ──────────
	const [lines, setLines] = useState<LineDraft[]>([]);
	const [currency, setCurrency] = useState<string>("");
	const [issueDate, setIssueDate] = useState("");
	const [dueDate, setDueDate] = useState("");
	const [periodStart, setPeriodStart] = useState("");
	const [periodEnd, setPeriodEnd] = useState("");
	const [notes, setNotes] = useState("");
	const [hoursDetail, setHoursDetail] = useState<HoursDetailLevel>("summary");
	const [attachHours, setAttachHours] = useState(false);
	const [seeded, setSeeded] = useState(false);
	// The saved invoice awaiting send confirmation; set once the pre-issue save
	// lands, cleared when the consultant confirms or backs out.
	const [confirmIssue, setConfirmIssue] = useState<Invoice | null>(null);

	// Seed after the queries resolve (existing invoice takes priority over
	// contract/project defaults). Runs once.
	if (
		!seeded &&
		!projectQuery.isPending &&
		!contractsQuery.isPending &&
		(!invoiceId || !existingQuery.isPending)
	) {
		if (existing) {
			setLines(
				existing.line_items.length > 0
					? existing.line_items.map((li) => ({
							key: li.id,
							description: li.description,
							quantity: String(li.quantity),
							unit_rate: String(li.unit_rate),
						}))
					: [emptyLine()],
			);
			setCurrency(existing.currency);
			setIssueDate(existing.issue_date ?? "");
			setDueDate(existing.due_date ?? "");
			setPeriodStart(existing.period_start ?? "");
			setPeriodEnd(existing.period_end ?? "");
			setNotes(existing.notes ?? "");
			setHoursDetail(existing.hours_detail_level ?? "summary");
		} else {
			setLines([emptyLine()]);
			setCurrency(contract?.currency ?? projectCurrency);
		}
		setSeeded(true);
	}

	const issuedBy: InvoicePreviewParty = existing?.issued_by ?? {
		name: contract?.provider_name,
		address: contract?.provider_address,
		tin: contract?.provider_tin,
		email: contract?.provider_email,
	};
	const billTo: InvoicePreviewParty = existing?.bill_to ?? {
		name: contract?.client_name,
		address: contract?.client_address,
		tin: contract?.client_tin,
		email: contract?.client_email,
	};

	// Issue/send is gated on there being a client to reach (mirrors the backend
	// guard): a linked recipient, a client email on the contract, or a real
	// project client.
	const canIssue = invoiceHasClient({
		recipientUserId: existing?.recipient_user_id,
		billToEmail: billTo.email,
		projectHasClient: projectQuery.data?.has_client,
	});

	const previewLines = lines.map((l) => ({
		description: l.description,
		quantity: Number(l.quantity) || 0,
		unit_rate: Number(l.unit_rate) || 0,
	}));

	const buildPayload = () => {
		const validLines = lines
			.map((l) => ({
				description: l.description.trim(),
				quantity: Number(l.quantity) || 0,
				unit_rate: Number(l.unit_rate) || 0,
			}))
			.filter((l) => l.description && l.quantity > 0);
		return {
			currency: currency || projectCurrency,
			issue_date: issueDate || undefined,
			due_date: dueDate || undefined,
			period_start: periodStart || undefined,
			period_end: periodEnd || undefined,
			hours_detail_level: hoursDetail,
			notes: notes.trim() || undefined,
			attach_hours: attachHours,
			line_items: validLines.length > 0 ? validLines : undefined,
		};
	};

	const saveMutation = useMutation({
		mutationFn: async () => {
			const payload = buildPayload();
			if (invoiceId) {
				return invoiceService.update(invoiceId, payload);
			}
			return invoiceService.create({ project_id: projectId, ...payload });
		},
		onSuccess: (inv) => {
			toast.success(invoiceId ? "Invoice saved" : "Draft created");
			void qc.invalidateQueries({
				queryKey: ["invoices", "project", projectId],
			});
			if (!invoiceId) {
				void navigate({
					to: "/finance/invoices/$invoiceId/edit",
					params: { invoiceId: inv.id },
					search: { projectId },
				});
			} else {
				void qc.invalidateQueries({ queryKey: ["invoice", invoiceId] });
			}
		},
		onError: (err: Error) => toast.error(err.message),
	});

	/**
	 * Step one of issuing: persist the edits, then hand the SAVED invoice to the
	 * confirmation. Saving first is what lets the confirmation preview the real
	 * stored document — including server-side totals and any hours appended on
	 * save — rather than a draft that may not survive the round trip.
	 */
	const prepareIssueMutation = useMutation({
		mutationFn: async () =>
			invoiceId
				? invoiceService.update(invoiceId, buildPayload())
				: invoiceService.create({ project_id: projectId, ...buildPayload() }),
		onSuccess: (saved) => {
			void qc.invalidateQueries({
				queryKey: ["invoices", "project", projectId],
			});
			if (invoiceId)
				void qc.invalidateQueries({ queryKey: ["invoice", saved.id] });
			setConfirmIssue(saved);
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const issueMutation = useMutation({
		mutationFn: (id: string) => invoiceService.issue(id),
		onSuccess: (invoice) => {
			// Mirrors payments.tsx: a failed send warns rather than succeeds, so
			// nobody walks away thinking the client was emailed when they weren't.
			const delivery = invoice.email_delivery;
			if (delivery?.sent) {
				toast.success(`Invoice issued and emailed to ${delivery.to}`);
			} else {
				toast.warning(
					`Invoice issued, but not emailed — ${
						delivery?.reason ?? "no client email on file."
					} Use Re-send once that's fixed.`,
				);
			}
			setConfirmIssue(null);
			void qc.invalidateQueries({
				queryKey: ["invoices", "project", projectId],
			});
			void navigate({
				to: "/finance",
				search: { tab: "invoices", projectId },
			});
		},
		onError: (err: Error) => {
			toast.error(err.message);
			setConfirmIssue(null);
		},
	});

	const pdfMutation = useMutation({
		mutationFn: async () => {
			if (!invoiceId)
				throw new Error("Save the draft before generating a PDF.");
			await invoiceService.generatePdf(invoiceId);
			return invoiceService.getPdfUrl(invoiceId);
		},
		onSuccess: ({ url }) => window.open(url, "_blank", "noopener,noreferrer"),
		onError: (err: Error) => toast.error(err.message),
	});

	const addServiceLine = (serviceId: string) => {
		const svc = contract?.services.find((s) => s.id === serviceId);
		if (!svc) return;
		setLines((prev) => [
			...prev.filter((l) => l.description || l.unit_rate !== "0"),
			{
				key: crypto.randomUUID(),
				description: svc.name,
				quantity: "1",
				unit_rate: String(svc.unit_rate),
			},
		]);
	};

	const patchLine = (key: string, patch: Partial<LineDraft>) =>
		setLines((prev) =>
			prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
		);
	const removeLine = (key: string) =>
		setLines((prev) => prev.filter((l) => l.key !== key));

	const isEditableDraft = !existing || existing.status === "draft";
	const isBusy =
		saveMutation.isPending ||
		prepareIssueMutation.isPending ||
		issueMutation.isPending ||
		pdfMutation.isPending;

	if (projectQuery.isPending || (invoiceId && existingQuery.isPending)) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (existing && !isEditableDraft) {
		return (
			<div className="mx-auto max-w-lg p-10 text-center">
				<p className="text-sm text-muted-foreground">
					Invoice {existing.number} is {existing.status} and can no longer be
					edited.
				</p>
			</div>
		);
	}

	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			<div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-5 py-6 md:px-8 md:py-8 lg:grid-cols-[1fr_540px]">
				{/* ── Form ── */}
				<div className="space-y-6">
					<div className="flex items-center justify-between">
						<h1 className="text-2xl font-bold text-foreground">
							{invoiceId ? "Edit invoice" : "Create invoice"}
						</h1>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => saveMutation.mutate()}
								disabled={isBusy}
								className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-card-foreground hover:bg-muted disabled:opacity-50"
							>
								{saveMutation.isPending ? "Saving…" : "Save as draft"}
							</button>
							<button
								type="button"
								onClick={() => prepareIssueMutation.mutate()}
								disabled={isBusy || !canIssue}
								title={canIssue ? undefined : NO_CLIENT_HINT}
								className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<Send className="h-3.5 w-3.5" />
								{prepareIssueMutation.isPending ? "Saving…" : "Issue"}
							</button>
						</div>
					</div>

					{!contract && (
						<p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
							No contract on this project yet — the invoice will have no
							bill-to/from details until a contract is set up.
						</p>
					)}

					<Field label="Currency">
						<CurrencySelect
							value={currency || projectCurrency}
							onChange={setCurrency}
						/>
					</Field>

					<div className="grid grid-cols-2 gap-4">
						<Field label="Issue date">
							<input
								type="date"
								value={issueDate}
								onChange={(e) => setIssueDate(e.target.value)}
								className={inputClass}
							/>
						</Field>
						<Field label="Due date">
							<input
								type="date"
								value={dueDate}
								onChange={(e) => setDueDate(e.target.value)}
								className={inputClass}
							/>
						</Field>
						<Field label="Period start">
							<input
								type="date"
								value={periodStart}
								onChange={(e) => setPeriodStart(e.target.value)}
								className={inputClass}
							/>
						</Field>
						<Field label="Period end">
							<input
								type="date"
								value={periodEnd}
								onChange={(e) => setPeriodEnd(e.target.value)}
								className={inputClass}
							/>
						</Field>
					</div>

					{/* Line items */}
					<div>
						<div className="mb-2 flex items-center justify-between">
							<p className="text-sm font-semibold text-foreground">
								Line items
							</p>
							{contract && contract.services.length > 0 && (
								<select
									value=""
									onChange={(e) =>
										e.target.value && addServiceLine(e.target.value)
									}
									className="rounded-lg border border-input bg-card px-2 py-1.5 text-xs text-card-foreground"
								>
									<option value="">+ Add from services…</option>
									{contract.services.map((s) => (
										<option key={s.id} value={s.id}>
											{s.name} ({s.unit_rate})
										</option>
									))}
								</select>
							)}
						</div>
						<div className="space-y-2">
							{lines.map((line) => (
								<div
									key={line.key}
									className="grid grid-cols-[1fr_80px_100px_auto] gap-2"
								>
									<input
										type="text"
										placeholder="Description"
										value={line.description}
										onChange={(e) =>
											patchLine(line.key, { description: e.target.value })
										}
										className={inputClass}
									/>
									<input
										type="number"
										min={0}
										step="0.01"
										placeholder="Qty"
										value={line.quantity}
										onChange={(e) =>
											patchLine(line.key, { quantity: e.target.value })
										}
										className={inputClass}
									/>
									<input
										type="number"
										min={0}
										step="0.01"
										placeholder="Rate"
										value={line.unit_rate}
										onChange={(e) =>
											patchLine(line.key, { unit_rate: e.target.value })
										}
										className={inputClass}
									/>
									<button
										type="button"
										onClick={() => removeLine(line.key)}
										className="rounded-lg border border-border px-2 text-muted-foreground hover:border-destructive hover:text-destructive"
									>
										<Trash2 className="h-4 w-4" />
									</button>
								</div>
							))}
						</div>
						<button
							type="button"
							onClick={() => setLines((p) => [...p, emptyLine()])}
							className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
						>
							<Plus className="h-3.5 w-3.5" /> Add line
						</button>
					</div>

					{/* Approved-hours attach */}
					<div className="rounded-lg border border-border bg-card p-3">
						<label className="flex items-center gap-2 text-sm text-foreground">
							<input
								type="checkbox"
								checked={attachHours}
								onChange={(e) => setAttachHours(e.target.checked)}
							/>
							Attach approved hours for the period (priced at the contract's
							client rate)
						</label>
						{attachHours && (
							<div className="mt-3">
								<Field label="Client sees">
									<select
										value={hoursDetail}
										onChange={(e) =>
											setHoursDetail(e.target.value as HoursDetailLevel)
										}
										className={inputClass}
									>
										<option value="none">No hours shown</option>
										<option value="summary">Hours summarised</option>
										<option value="detailed">Hours itemised by task</option>
									</select>
								</Field>
							</div>
						)}
					</div>

					<Field label="Notes to client">
						<textarea
							value={notes}
							rows={3}
							onChange={(e) => setNotes(e.target.value)}
							className={inputClass}
						/>
					</Field>

					{invoiceId && (
						<button
							type="button"
							onClick={() => pdfMutation.mutate()}
							disabled={isBusy}
							className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-card-foreground hover:bg-muted disabled:opacity-50"
						>
							<Download className="h-3.5 w-3.5" />
							{pdfMutation.isPending
								? "Generating…"
								: "Generate & download PDF"}
						</button>
					)}
				</div>

				{/* ── Live preview ── */}
				<div className="lg:sticky lg:top-6 lg:self-start">
					<p className="mb-3 text-sm font-semibold text-foreground">Preview</p>
					<InvoicePreview
						number={existing?.number ?? ""}
						currency={currency || projectCurrency}
						issueDate={issueDate || null}
						dueDate={dueDate || null}
						periodStart={periodStart || null}
						periodEnd={periodEnd || null}
						issuedBy={issuedBy}
						billTo={billTo}
						paymentMethod={contract?.payment_method}
						notes={notes || null}
						lines={previewLines}
						hoursNote={
							attachHours
								? "+ approved hours for the period, added at the client rate on save"
								: null
						}
					/>
				</div>
			</div>

			{confirmIssue && (
				<ConfirmIssueInvoiceModal
					invoice={confirmIssue}
					isPending={issueMutation.isPending}
					onCancel={() => setConfirmIssue(null)}
					onConfirm={() => issueMutation.mutate(confirmIssue.id)}
				/>
			)}
		</div>
	);
}

const inputClass =
	"w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25";

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				{label}
			</p>
			{children}
		</div>
	);
}
