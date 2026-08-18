import { useQuery } from "@tanstack/react-query";
import {
	Eye,
	EyeOff,
	Loader2,
	Paperclip,
	QrCode,
	Wallet,
	XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { useToast } from "@/hooks/useToast";
import {
	type Payout,
	type PayoutMethod,
	payoutsService,
} from "@/services/payouts.service";
import type { TaskTimeLog } from "@/services/team-time.service";
import type { PayPeriodConfig } from "@/services/teams.service";
import { uploadService } from "@/services/upload.service";
import { payPeriodForDate, payPeriodLabel } from "./log-period";
import { formatMoney, logFee } from "./time-utils";

interface PayMemberModalProps {
	isOpen: boolean;
	teamId: string;
	memberId: string;
	memberLabel: string;
	currency: string;
	logs: TaskTimeLog[];
	/** Team cut-off schedule, used to break a multi-period payout down. */
	payPeriodConfig?: PayPeriodConfig | null;
	onClose: () => void;
	onSuccess: (payout: Payout) => void;
}

const METHOD_LABEL: Record<string, string> = {
	bank: "Bank",
	gcash: "GCash",
	maya: "Maya",
	paypal: "PayPal",
	other: "Other",
};

function maskIdentifier(value: string): string {
	if (value.length <= 4) return `••${value.slice(-2)}`;
	return `••••${value.slice(-4)}`;
}

function todayInputValue(): string {
	const now = new Date();
	const offset = now.getTimezoneOffset();
	return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function PayMemberModal({
	isOpen,
	teamId,
	memberId,
	memberLabel,
	currency,
	logs,
	payPeriodConfig,
	onClose,
	onSuccess,
}: PayMemberModalProps) {
	const toast = useToast();
	const [methodId, setMethodId] = useState<string>("");
	const [reveal, setReveal] = useState(false);
	const [reference, setReference] = useState("");
	const [note, setNote] = useState("");
	const [paidAt, setPaidAt] = useState(todayInputValue);
	const [proofFile, setProofFile] = useState<File | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const methodsQuery = useQuery({
		queryKey: ["payout-methods", "member", teamId, memberId],
		queryFn: () => payoutsService.listMemberMethods(teamId, memberId),
		enabled: isOpen,
	});

	const methods = useMemo(() => methodsQuery.data ?? [], [methodsQuery.data]);

	// Default the selected method to the member's default (or first).
	useEffect(() => {
		if (!isOpen) return;
		if (methodId) return;
		if (methods.length === 0) return;
		const preferred = methods.find((m) => m.is_default) ?? methods[0];
		setMethodId(preferred.id);
	}, [isOpen, methods, methodId]);

	// Reset transient state when reopened.
	useEffect(() => {
		if (!isOpen) {
			setMethodId("");
			setReveal(false);
			setReference("");
			setNote("");
			setPaidAt(todayInputValue());
			setProofFile(null);
			setSubmitting(false);
		}
	}, [isOpen]);

	const total = useMemo(
		() => logs.reduce((sum, log) => sum + logFee(log), 0),
		[logs],
	);
	const totalSeconds = useMemo(
		() => logs.reduce((sum, log) => sum + (log.duration_seconds ?? 0), 0),
		[logs],
	);

	// Break the payout down by cut-off period so a multi-period payment is clear.
	const breakdown = useMemo(() => {
		const map = new Map<
			string,
			{
				key: string;
				label: string;
				logs: number;
				seconds: number;
				amount: number;
				sortKey: number;
			}
		>();
		for (const log of logs) {
			const { month, period } = payPeriodForDate(
				payPeriodConfig,
				new Date(log.started_at),
			);
			const key = `${month}:${period.id}`;
			let b = map.get(key);
			if (!b) {
				b = {
					key,
					label: payPeriodLabel(period),
					logs: 0,
					seconds: 0,
					amount: 0,
					sortKey: period.from.getTime(),
				};
				map.set(key, b);
			}
			b.logs += 1;
			b.seconds += log.duration_seconds ?? 0;
			b.amount += logFee(log);
		}
		return Array.from(map.values()).sort((a, b) => a.sortKey - b.sortKey);
	}, [logs, payPeriodConfig]);

	const selectedMethod: PayoutMethod | undefined = methods.find(
		(m) => m.id === methodId,
	);

	const handleSubmit = async () => {
		if (logs.length === 0) return;
		setSubmitting(true);
		try {
			let proofPath: string | undefined;
			if (proofFile) {
				proofPath = await uploadService.uploadPayoutProof(proofFile);
			}
			const payout = await payoutsService.createPayout({
				team_id: teamId,
				member_user_id: memberId,
				log_ids: logs.map((l) => l.id),
				payout_method_id: methodId || undefined,
				reference_number: reference.trim() || undefined,
				proof_path: proofPath,
				note: note.trim() || undefined,
				paid_at: paidAt ? new Date(paidAt).toISOString() : undefined,
				source: "batch",
			});
			toast.success(
				`Recorded payout of ${formatMoney(payout.total_amount, payout.currency)} to ${memberLabel}.`,
			);
			onSuccess(payout);
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<AppDialog
			open={isOpen}
			onClose={onClose}
			busy={submitting}
			size="md"
			className="max-h-[92vh]"
			title={
				<span className="flex items-center gap-2">
					<Wallet className="h-4 w-4 text-primary" />
					Pay {memberLabel}
				</span>
			}
			description="Record a payment you made outside the app. This marks the selected logs as paid."
			footer={
				<>
					<button
						type="button"
						onClick={onClose}
						disabled={submitting}
						className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
					>
						<XCircle className="h-3.5 w-3.5" />
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void handleSubmit()}
						disabled={submitting || logs.length === 0}
						className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{submitting ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Wallet className="h-3.5 w-3.5" />
						)}
						Record payout
					</button>
				</>
			}
		>
			<div className="space-y-4">
				{/* Summary */}
				<div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-muted p-3 text-center">
					<div>
						<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
							Logs
						</div>
						<div className="text-sm font-semibold text-foreground">
							{logs.length}
						</div>
					</div>
					<div>
						<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
							Hours
						</div>
						<div className="text-sm font-semibold text-foreground">
							{(totalSeconds / 3600).toFixed(2)}
						</div>
					</div>
					<div>
						<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
							Total
						</div>
						<div className="text-sm font-semibold text-success">
							{formatMoney(total, currency)}
						</div>
					</div>
				</div>

				{/* Cut-off breakdown (only when the payment spans multiple cut-offs) */}
				{breakdown.length > 1 && (
					<div className="rounded-xl border border-border p-3">
						<div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
							Across {breakdown.length} cut-offs
						</div>
						<ul className="space-y-1">
							{breakdown.map((b) => (
								<li
									key={b.key}
									className="flex items-center justify-between gap-3 text-xs"
								>
									<span className="text-muted-foreground">
										{b.label}{" "}
										<span className="text-muted-foreground/70">
											· {b.logs} log{b.logs === 1 ? "" : "s"} ·{" "}
											{(b.seconds / 3600).toFixed(2)}h
										</span>
									</span>
									<span className="font-semibold tabular-nums text-foreground">
										{formatMoney(b.amount, currency)}
									</span>
								</li>
							))}
						</ul>
					</div>
				)}

				{/* Method */}
				<div className="space-y-1.5">
					<label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Pay to
					</label>
					{methodsQuery.isPending ? (
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading methods…
						</div>
					) : methods.length === 0 ? (
						<div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
							{memberLabel} hasn't added a payout method yet. You can still
							record this payout without one.
						</div>
					) : (
						<>
							<select
								value={methodId}
								onChange={(e) => setMethodId(e.target.value)}
								className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
							>
								<option value="">No specific method</option>
								{methods.map((m) => (
									<option key={m.id} value={m.id}>
										{METHOD_LABEL[m.method_type] ?? m.method_type}
										{m.label ? ` · ${m.label}` : ""} ·{" "}
										{maskIdentifier(m.account_identifier)}
									</option>
								))}
							</select>
							{selectedMethod && (
								<div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
									<div>
										<div className="font-medium text-foreground">
											{selectedMethod.account_name}
											{selectedMethod.bank_name
												? ` · ${selectedMethod.bank_name}`
												: ""}
										</div>
										<div className="tabular-nums">
											{reveal
												? selectedMethod.account_identifier
												: maskIdentifier(selectedMethod.account_identifier)}
										</div>
									</div>
									<button
										type="button"
										onClick={() => setReveal((v) => !v)}
										className="rounded-md p-1 text-muted-foreground hover:bg-muted-foreground/10"
										title={reveal ? "Hide" : "Reveal"}
									>
										{reveal ? (
											<EyeOff className="h-3.5 w-3.5" />
										) : (
											<Eye className="h-3.5 w-3.5" />
										)}
									</button>
								</div>
							)}
							{selectedMethod?.qr_url && (
								<div className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-3">
									<span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
										<QrCode className="h-3.5 w-3.5" />
										Scan to pay
									</span>
									<img
										src={selectedMethod.qr_url}
										alt="Scan-to-pay QR"
										className="h-44 w-44 rounded-md object-contain"
									/>
								</div>
							)}
						</>
					)}
				</div>

				{/* Reference + date */}
				<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
					<div className="space-y-1.5">
						<label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Reference #
						</label>
						<input
							type="text"
							value={reference}
							onChange={(e) => setReference(e.target.value)}
							placeholder="e.g. GCash ref 8821…"
							className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
						/>
					</div>
					<div className="space-y-1.5">
						<label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Date paid
						</label>
						<input
							type="date"
							value={paidAt}
							onChange={(e) => setPaidAt(e.target.value)}
							className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
						/>
					</div>
				</div>

				{/* Proof */}
				<div className="space-y-1.5">
					<label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Proof (optional)
					</label>
					<label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
						<Paperclip className="h-3.5 w-3.5" />
						{proofFile ? proofFile.name : "Attach a screenshot or PDF"}
						<input
							type="file"
							accept="image/*,application/pdf"
							className="hidden"
							onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
						/>
					</label>
				</div>

				{/* Note */}
				<div className="space-y-1.5">
					<label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Note (optional)
					</label>
					<textarea
						value={note}
						onChange={(e) => setNote(e.target.value)}
						rows={2}
						className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
					/>
				</div>
			</div>
		</AppDialog>
	);
}
