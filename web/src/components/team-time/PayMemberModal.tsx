import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Eye,
	EyeOff,
	Loader2,
	Paperclip,
	QrCode,
	Wallet,
	XCircle,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { useToast } from "@/hooks/useToast";
import { isNativeApp } from "@/lib/platform";
import { canHandleSensitiveData } from "@/lib/sensitiveData";
import { NATIVE_WEB_ONLY_COPY, timeErrorCopy } from "@/lib/timeErrors";
import {
	deviceTimeZone,
	firstName,
	formatClock,
	formatDurationText,
	formatMoneyLine,
} from "@/lib/timeFormat";
import { localDate, safeTimezone } from "@/lib/timePeriods";
import { invalidateTime } from "@/queries/time";
import {
	type Payout,
	type PayoutMethod,
	payoutsService,
} from "@/services/payouts.service";
import type { PayPeriodConfig } from "@/services/teams.service";
import { uploadService } from "@/services/upload.service";
import { useUser } from "@/stores/authStore";
import {
	payPeriodForDate,
	payPeriodLabel,
	type ResolvedPayPeriod,
} from "./log-period";

// ── Payable time: the pure part, shared with TeamPayoutsPanel ───────────────

/**
 * The fields a payment needs from a time entry. `TimeEntryView` (the
 * `/api/time` read) fits it as is, and so does the old team-time row the
 * pages still on the alias pass, until W2-5 and W3-1 replace them.
 */
export interface PayableEntry {
	id: string;
	started_at: string;
	/** Approved (frozen) time. A payment pays this, never the raw duration. */
	payable_seconds?: number | null;
	/** Read only when `payable_seconds` is absent (rows from the old alias). */
	duration_seconds?: number | null;
	/** Absent when the viewer can't see cost. */
	rate_snapshot?: number | null;
	currency_snapshot?: string | null;
}

/** The time a payment pays for one entry, in seconds (never negative). */
export function entryPayableSeconds(entry: PayableEntry): number {
	const seconds = entry.payable_seconds ?? entry.duration_seconds ?? 0;
	return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

function entryRate(entry: PayableEntry): number {
	const rate = Number(entry.rate_snapshot ?? 0);
	return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

/**
 * What the payment records for these entries: Σ payable hours × rate,
 * rounded to cents once on the sum (L63, CHANGE-23), the same as the
 * `create_payout_and_mark_paid` RPC and the owed balances. Rounding each
 * entry first would drift by up to half a cent per entry.
 */
export function payoutTotal(entries: readonly PayableEntry[]): number {
	let raw = 0;
	for (const entry of entries) {
		raw += (entryPayableSeconds(entry) / 3600) * entryRate(entry);
	}
	return Math.round(raw * 100) / 100;
}

/** Σ payable seconds. */
export function payableSecondsOf(entries: readonly PayableEntry[]): number {
	return entries.reduce((sum, entry) => sum + entryPayableSeconds(entry), 0);
}

/** A pay cut-off as local dates of the team's time zone. */
export interface EntryCutoff {
	/** `${YYYY-MM}:${period id}`. */
	key: string;
	month: string;
	period: ResolvedPayPeriod;
	/** First and last day, `YYYY-MM-DD`, inclusive. */
	from: string;
	to: string;
	payDate: string;
	/** "1–15 Oct 2026". */
	label: string;
}

function isoDay(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/**
 * The cut-off an entry falls in. Its day is the local date of `started_at`
 * in the team's time zone (L65), never the browser's, so a Manila team's
 * 7:30 am entry on the 16th never lands in the 1–15 cut-off for a payer in
 * New York.
 */
export function cutoffForEntry(
	startedAt: string,
	config: PayPeriodConfig | null | undefined,
	timezone: string | null | undefined,
): EntryCutoff {
	const day = localDate(startedAt, safeTimezone(timezone));
	const [y, m, d] = day.split("-").map(Number);
	// log-period works on calendar fields, so hand it that calendar day.
	const { month, period } = payPeriodForDate(config, new Date(y, m - 1, d));
	return {
		key: `${month}:${period.id}`,
		month,
		period,
		from: isoDay(period.from),
		to: isoDay(period.to),
		payDate: isoDay(period.payDate),
		label: payPeriodLabel(period),
	};
}

// ── The dialog ──────────────────────────────────────────────────────────────

export interface PayMemberModalProps {
	isOpen: boolean;
	teamId: string;
	memberId: string;
	memberLabel: string;
	currency: string;
	/** The Owed entries to pay: approved, unpaid, team time, one currency. */
	entries?: readonly PayableEntry[];
	/**
	 * @deprecated The old name of `entries`, still passed by the pages that
	 * W2-5 and W3-1 replace (project Time, Team Logs).
	 */
	logs?: readonly PayableEntry[];
	/** Team cut-off schedule, used to break a multi-period payment down. */
	payPeriodConfig?: PayPeriodConfig | null;
	/** The team's time zone (cut-offs are counted in it). The device's when absent. */
	timezone?: string | null;
	/**
	 * This person's time in the same cut-offs that isn't approved yet. It is
	 * never part of the payment; the dialog says so, so nobody thinks the
	 * figure is the whole period.
	 */
	unapprovedSeconds?: number;
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

/** Copy (web only: the dialog never renders its form in the app). */
export const PAY_MEMBER_COPY = {
	description:
		"Record a payment you made outside Proyekto. The time below is marked as paid.",
	selfPayment: "Someone else on the team has to record your payment.",
	unapproved: (seconds: number, name: string) =>
		`${formatDurationText(seconds)} of ${name}'s time in this period isn't approved yet. It isn't part of this payment; pay it once it's approved.`,
	noTime: "There's no approved, unpaid time to pay here.",
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

/**
 * The payment date as an instant. Midday on that calendar day, so the date
 * reads the same in every time zone (a bare date is UTC midnight, which is
 * the day before for anyone west of Greenwich).
 */
function paidAtInstant(value: string): string | undefined {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
	const local = new Date(`${value}T12:00:00`);
	return Number.isNaN(local.getTime()) ? undefined : local.toISOString();
}

export function PayMemberModal(props: PayMemberModalProps) {
	if (isNativeApp()) {
		return (
			<NativePayMemberNotice open={props.isOpen} onClose={props.onClose} />
		);
	}
	return <PayMemberDialog {...props} />;
}

/**
 * Recording a payment is a web surface (L54: payouts are money pages, so the
 * app never shows them). A host that still mounts this dialog in the app gets
 * a pointer to the web, never the form.
 */
function NativePayMemberNotice({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	return (
		<AppDialog
			open={open}
			onClose={onClose}
			size="sm"
			ariaLabel={NATIVE_WEB_ONLY_COPY}
			footer={
				<button
					type="button"
					onClick={onClose}
					className="inline-flex items-center rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"
				>
					Close
				</button>
			}
		>
			<p className="text-sm text-muted-foreground">{NATIVE_WEB_ONLY_COPY}</p>
		</AppDialog>
	);
}

function PayMemberDialog({
	isOpen,
	teamId,
	memberId,
	memberLabel,
	currency,
	entries: entriesProp,
	logs,
	payPeriodConfig,
	timezone,
	unapprovedSeconds = 0,
	onClose,
	onSuccess,
}: PayMemberModalProps) {
	const toast = useToast();
	const qc = useQueryClient();
	const viewer = useUser();
	// The member's stored payout details (account numbers, scan-to-pay QR)
	// are web-only — see lib/sensitiveData.ts.
	const showMethods = canHandleSensitiveData();
	const [methodId, setMethodId] = useState<string>("");
	const [reveal, setReveal] = useState(false);
	const [reference, setReference] = useState("");
	const [note, setNote] = useState("");
	const [paidAt, setPaidAt] = useState(todayInputValue);
	const [proofFile, setProofFile] = useState<File | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const entries = useMemo<readonly PayableEntry[]>(
		() => entriesProp ?? logs ?? [],
		[entriesProp, logs],
	);
	const zone = safeTimezone(timezone ?? deviceTimeZone());
	// No self-payment (CHANGE-9): the server refuses it too
	// (PAYOUT_SELF_NOT_ALLOWED), so say it before anyone fills the form in.
	const isSelf = Boolean(viewer?.id) && viewer?.id === memberId;

	const methodsQuery = useQuery({
		queryKey: ["payout-methods", "member", teamId, memberId],
		queryFn: () => payoutsService.listMemberMethods(teamId, memberId),
		enabled: isOpen && showMethods && !isSelf,
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

	const total = useMemo(() => payoutTotal(entries), [entries]);
	const totalSeconds = useMemo(() => payableSecondsOf(entries), [entries]);

	// Break the payment down by cut-off so a multi-period payment is clear.
	// Per-cut-off lines are display only; the total above is the one rounded
	// once, which is what gets recorded.
	const breakdown = useMemo(() => {
		const map = new Map<
			string,
			{
				key: string;
				label: string;
				entries: PayableEntry[];
				from: string;
			}
		>();
		for (const entry of entries) {
			const cutoff = cutoffForEntry(entry.started_at, payPeriodConfig, zone);
			let bucket = map.get(cutoff.key);
			if (!bucket) {
				bucket = {
					key: cutoff.key,
					label: cutoff.label,
					entries: [],
					from: cutoff.from,
				};
				map.set(cutoff.key, bucket);
			}
			bucket.entries.push(entry);
		}
		return Array.from(map.values()).sort((a, b) =>
			a.from.localeCompare(b.from),
		);
	}, [entries, payPeriodConfig, zone]);

	const selectedMethod: PayoutMethod | undefined = methods.find(
		(m) => m.id === methodId,
	);
	const personName = firstName(memberLabel) ?? memberLabel;
	const canRecord = !submitting && !isSelf && entries.length > 0 && total > 0;

	const handleSubmit = async () => {
		if (!canRecord) return;
		setSubmitting(true);
		try {
			let proofPath: string | undefined;
			if (proofFile) {
				proofPath = await uploadService.uploadPayoutProof(proofFile);
			}
			const payout = await payoutsService.createPayout({
				team_id: teamId,
				member_user_id: memberId,
				entry_ids: entries.map((entry) => entry.id),
				payout_method_id: (showMethods && methodId) || undefined,
				reference_number: reference.trim() || undefined,
				proof_path: proofPath,
				note: note.trim() || undefined,
				paid_at: paidAtInstant(paidAt),
				source: "batch",
			});
			toast.success(
				`Recorded a payment of ${formatMoneyLine(payout.total_amount, payout.currency)} to ${memberLabel}.`,
			);
			// Paid locks on entries and sheets, owed balances, history, reports.
			void invalidateTime(qc, "payout");
			onSuccess(payout);
		} catch (e) {
			const copy = timeErrorCopy(e, { subject: "entry", operation: "write" });
			// A plan refusal already raised the app-wide upgrade prompt.
			if (copy.code !== "plan_limit") toast.error(copy.message);
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
					<Wallet className="h-4 w-4 text-primary" aria-hidden="true" />
					Pay {memberLabel}
				</span>
			}
			description={PAY_MEMBER_COPY.description}
			footer={
				<>
					<button
						type="button"
						onClick={onClose}
						disabled={submitting}
						className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
					>
						<XCircle className="h-3.5 w-3.5" aria-hidden="true" />
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void handleSubmit()}
						disabled={!canRecord}
						className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{submitting ? (
							<Loader2
								className="h-3.5 w-3.5 animate-spin"
								aria-hidden="true"
							/>
						) : (
							<Wallet className="h-3.5 w-3.5" aria-hidden="true" />
						)}
						Record payout
					</button>
				</>
			}
		>
			<div className="space-y-4">
				{isSelf ? (
					<Notice>{PAY_MEMBER_COPY.selfPayment}</Notice>
				) : entries.length === 0 || total <= 0 ? (
					<Notice>{PAY_MEMBER_COPY.noTime}</Notice>
				) : null}

				{/* Summary */}
				<div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-muted p-3 text-center">
					<div>
						<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
							Entries
						</div>
						<div className="text-sm font-semibold text-foreground">
							{entries.length}
						</div>
					</div>
					<div>
						<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
							Approved
						</div>
						<div className="text-sm font-semibold tabular-nums text-foreground">
							{formatClock(totalSeconds)}
						</div>
					</div>
					<div>
						<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
							Total
						</div>
						<div
							className="text-sm font-semibold tabular-nums text-success"
							data-testid="pay-total"
						>
							{formatMoneyLine(total, currency)}
						</div>
					</div>
				</div>

				{unapprovedSeconds > 0 ? (
					<Notice>
						{PAY_MEMBER_COPY.unapproved(unapprovedSeconds, personName)}
					</Notice>
				) : null}

				{/* Cut-off breakdown (only when the payment spans several cut-offs) */}
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
											· {b.entries.length}{" "}
											{b.entries.length === 1 ? "entry" : "entries"} ·{" "}
											{formatClock(payableSecondsOf(b.entries))}
										</span>
									</span>
									<span className="font-semibold tabular-nums text-foreground">
										{formatMoneyLine(payoutTotal(b.entries), currency)}
									</span>
								</li>
							))}
						</ul>
					</div>
				)}

				{/* Method */}
				<div className="space-y-1.5">
					<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Pay to
					</span>
					{!showMethods ? (
						<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
							{memberLabel}'s payout details are shown on the web. You can
							record this payout here without them.
						</p>
					) : isSelf ? null : methodsQuery.isPending ? (
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<Loader2
								className="h-3.5 w-3.5 animate-spin"
								aria-hidden="true"
							/>{" "}
							Loading methods…
						</div>
					) : methods.length === 0 ? (
						<div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
							{memberLabel} hasn't added a payout method yet. You can still
							record this payout without one.
						</div>
					) : (
						<>
							<select
								aria-label="Payout method"
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
										aria-label={reveal ? "Hide" : "Reveal"}
									>
										{reveal ? (
											<EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
										) : (
											<Eye className="h-3.5 w-3.5" aria-hidden="true" />
										)}
									</button>
								</div>
							)}
							{selectedMethod?.qr_url && (
								<div className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-3">
									<span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
										<QrCode className="h-3.5 w-3.5" aria-hidden="true" />
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
					<label className="space-y-1.5">
						<span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Reference #
						</span>
						<input
							type="text"
							value={reference}
							onChange={(e) => setReference(e.target.value)}
							placeholder="e.g. GCash ref 8821…"
							className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
						/>
					</label>
					<label className="space-y-1.5">
						<span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Date paid
						</span>
						<input
							type="date"
							value={paidAt}
							onChange={(e) => setPaidAt(e.target.value)}
							className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
						/>
					</label>
				</div>

				{/* Proof */}
				<div className="space-y-1.5">
					<span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Proof (optional)
					</span>
					<label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
						<Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
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
				<label className="block space-y-1.5">
					<span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Note (optional)
					</span>
					<textarea
						value={note}
						onChange={(e) => setNote(e.target.value)}
						rows={2}
						className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
					/>
				</label>
			</div>
		</AppDialog>
	);
}

function Notice({ children }: { children: ReactNode }) {
	return (
		<div
			role="status"
			className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground"
		>
			<AlertTriangle
				className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
				aria-hidden="true"
			/>
			<span>{children}</span>
		</div>
	);
}
