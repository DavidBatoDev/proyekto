import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Ban,
	CalendarClock,
	CheckCircle2,
	ClipboardCheck,
	ExternalLink,
	Hourglass,
	Loader2,
	Wallet,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { PlanLimitNotice } from "@/components/billing/PlanLimitNotice";
import { AppDialog } from "@/components/common/AppDialog";
import { FinanceQueryError } from "@/components/finance/access/FinanceAccessStates";
import {
	cutoffForEntry,
	PayMemberModal,
	payoutTotal,
} from "@/components/team-time/PayMemberModal";
import { useTeamMoneyAccess } from "@/components/team-time/useTeamMoneyAccess";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import { useToast } from "@/hooks/useToast";
import { isNativeApp } from "@/lib/platform";
import {
	NATIVE_FALLBACK_COPY,
	timeErrorMessage,
	timePlanCopy,
} from "@/lib/timeErrors";
import {
	deviceTimeZone,
	formatClock,
	formatDurationText,
	formatLocalDay,
	formatMoneyLine,
	joinMoneyLines,
	moneyLines,
} from "@/lib/timeFormat";
import { addDays, safeTimezone, todayIn } from "@/lib/timePeriods";
import type { TeamTimeReportSearch } from "@/lib/timeSearch";
import { invalidateTime, retryTimeQuery, timeQueries } from "@/queries/time";
import {
	type OwedBucket,
	type Payout,
	payoutEntries,
	payoutsService,
} from "@/services/payouts.service";
import type { PayPeriodConfig } from "@/services/teams.service";
import { listAllReportEntries } from "@/services/time.service";
import type { TimeEntryView } from "@/services/time.types";
import { useUser } from "@/stores/authStore";

export interface TeamPayoutsPanelLinks {
	/**
	 * Open the team Report filtered to one person and one cut-off's dates
	 * (`?person=&from=&to=`), where their not-yet-approved time and its
	 * timesheets show. Backs the per-person "Review" button; omit it and the
	 * button is hidden.
	 */
	openReport?: (search: TeamTimeReportSearch) => void;
}

export interface TeamPayoutsPanelProps {
	teamId: string;
	links?: TeamPayoutsPanelLinks;
}

// ── The window of time the page reads ───────────────────────────────────────

/**
 * The page reads the team's time from the start of the month two months
 * back (in the team's time zone). Payouts run every few weeks, so that holds
 * every open cut-off without walking the team's whole history, which keeps
 * growing with paid time. The owed balances cover all time, so older unpaid
 * time is never hidden: the page notices it and offers "Show older time".
 */
export function defaultPayoutWindowFrom(today: string): string {
	const [y, m] = today.split("-").map(Number);
	const index = y * 12 + (m - 1) - 2;
	const year = Math.floor(index / 12);
	const month = (index % 12) + 1;
	return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** "Show older time" reads from here. */
export const PAYOUT_HISTORY_FLOOR = "2000-01-01";
/** The most entries one read walks (the time API's page walker cap). */
export const PAYOUT_ENTRY_CAP = 10_000;

// ── Grouping (pure) ─────────────────────────────────────────────────────────

/** One person's balance in one currency within a cut-off. */
export interface PayoutMemberRow {
	key: string;
	memberId: string;
	label: string;
	avatarUrl: string | null;
	/** Null for a person whose time in the cut-off is all still unapproved. */
	currency: string | null;
	/** The Owed entries (approved, unpaid, hourly). */
	entries: TimeEntryView[];
	/** Σ payable seconds of `entries`. */
	seconds: number;
	/** What paying `entries` records: rounded once on the sum (L63). */
	amount: number;
	/** This person's time in the cut-off that isn't approved yet. */
	unapprovedSeconds: number;
	unapprovedCount: number;
}

export interface PayoutCutoffGroup {
	key: string;
	label: string;
	/** `YYYY-MM-DD`, inclusive, team time zone. */
	from: string;
	to: string;
	payDate: string;
	/** Its pay date has passed and it still has something to pay. */
	overdue: boolean;
	/** The cut-off hasn't ended yet. */
	inProgress: boolean;
	rows: PayoutMemberRow[];
	unapprovedSeconds: number;
	unapprovedCount: number;
}

export interface PayoutWindow {
	groups: PayoutCutoffGroup[];
	/** `${member}:${currency}` → Owed hourly entries in the window (compared with the owed balances). */
	owedCountByBucket: Record<string, number>;
	/** Σ row amounts per currency. */
	totalsByCurrency: Record<string, number>;
	/** Approved, unpaid fixed-pay entries: never paid by entry. */
	fixedCount: number;
}

function memberLabelOf(entry: TimeEntryView): string {
	const m = entry.member;
	const composed = [m?.first_name, m?.last_name]
		.filter(Boolean)
		.join(" ")
		.trim();
	return (
		m?.display_name ||
		composed ||
		entry.member_display_name_snapshot ||
		entry.member_label ||
		"Unknown member"
	);
}

interface MemberDraft {
	memberId: string;
	label: string;
	avatarUrl: string | null;
	byCurrency: Map<string, TimeEntryView[]>;
	unapprovedSeconds: number;
	unapprovedCount: number;
}

interface GroupDraft {
	key: string;
	label: string;
	from: string;
	to: string;
	payDate: string;
	members: Map<string, MemberDraft>;
}

/**
 * The team's time in the window, grouped into pay cut-offs (in the team's
 * time zone), then by person and currency. Owed time follows CHANGE-5:
 * approved (`payable_seconds` set), team time, no payment, no legacy marker;
 * fixed-pay time is counted apart (it is paid by hand, never by entry).
 * Paid time and legacy rejected time drop out. Everything else is time not
 * yet approved: it never adds to a payment, it is only reported beside it.
 */
export function buildPayoutWindow(
	entries: readonly TimeEntryView[],
	options: {
		config: PayPeriodConfig | null | undefined;
		timezone: string;
		today: string;
	},
): PayoutWindow {
	const groups = new Map<string, GroupDraft>();
	const owedCountByBucket: Record<string, number> = {};
	let fixedCount = 0;

	for (const entry of entries) {
		if (entry.context_kind !== "team") continue;
		if (entry.legacy_status === "rejected") continue;
		if (entry.payout_id || entry.legacy_status === "paid_outside") continue;
		const memberId = entry.member_user_id;
		if (!memberId) continue;
		const owed = entry.payable_seconds !== null;
		if (owed && entry.rate_type_snapshot === "fixed") {
			fixedCount += 1;
			continue;
		}

		const cutoff = cutoffForEntry(
			entry.started_at,
			options.config,
			options.timezone,
		);
		let group = groups.get(cutoff.key);
		if (!group) {
			group = {
				key: cutoff.key,
				label: cutoff.label,
				from: cutoff.from,
				to: cutoff.to,
				payDate: cutoff.payDate,
				members: new Map(),
			};
			groups.set(cutoff.key, group);
		}
		let member = group.members.get(memberId);
		if (!member) {
			member = {
				memberId,
				label: memberLabelOf(entry),
				avatarUrl: entry.member?.avatar_url ?? null,
				byCurrency: new Map(),
				unapprovedSeconds: 0,
				unapprovedCount: 0,
			};
			group.members.set(memberId, member);
		}

		if (owed) {
			const currency = entry.currency_snapshot || "USD";
			const list = member.byCurrency.get(currency) ?? [];
			list.push(entry);
			member.byCurrency.set(currency, list);
			const bucketKey = `${memberId}:${currency}`;
			owedCountByBucket[bucketKey] = (owedCountByBucket[bucketKey] ?? 0) + 1;
		} else {
			member.unapprovedCount += 1;
			member.unapprovedSeconds += Math.max(0, entry.duration_seconds ?? 0);
		}
	}

	const totalsByCurrency: Record<string, number> = {};
	const out: PayoutCutoffGroup[] = [];
	for (const g of groups.values()) {
		const rows: PayoutMemberRow[] = [];
		let unapprovedSeconds = 0;
		let unapprovedCount = 0;
		for (const m of g.members.values()) {
			unapprovedSeconds += m.unapprovedSeconds;
			unapprovedCount += m.unapprovedCount;
			if (m.byCurrency.size === 0) {
				rows.push({
					key: `${m.memberId}:-`,
					memberId: m.memberId,
					label: m.label,
					avatarUrl: m.avatarUrl,
					currency: null,
					entries: [],
					seconds: 0,
					amount: 0,
					unapprovedSeconds: m.unapprovedSeconds,
					unapprovedCount: m.unapprovedCount,
				});
				continue;
			}
			for (const [currency, list] of m.byCurrency) {
				const amount = payoutTotal(list);
				totalsByCurrency[currency] = (totalsByCurrency[currency] ?? 0) + amount;
				rows.push({
					key: `${m.memberId}:${currency}`,
					memberId: m.memberId,
					label: m.label,
					avatarUrl: m.avatarUrl,
					currency,
					entries: list,
					seconds: list.reduce((s, e) => s + (e.payable_seconds ?? 0), 0),
					amount,
					unapprovedSeconds: m.unapprovedSeconds,
					unapprovedCount: m.unapprovedCount,
				});
			}
		}
		rows.sort(
			(a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "en"),
		);
		const hasAmount = rows.some((r) => r.amount > 0);
		out.push({
			key: g.key,
			label: g.label,
			from: g.from,
			to: g.to,
			payDate: g.payDate,
			overdue: hasAmount && g.payDate < options.today,
			inProgress: g.to >= options.today,
			rows,
			unapprovedSeconds,
			unapprovedCount,
		});
	}
	out.sort((a, b) => b.from.localeCompare(a.from));
	return { groups: out, owedCountByBucket, totalsByCurrency, fixedCount };
}

/**
 * Whether the owed balances (all time) hold entries the window doesn't: some
 * unpaid, approved time is older than the window, so the page says so.
 */
export function owedOutsideWindow(
	owed: readonly OwedBucket[],
	slice: PayoutWindow,
): boolean {
	return owed.some((bucket) => {
		const count = bucket.entry_count ?? bucket.log_count ?? 0;
		const inWindow =
			slice.owedCountByBucket[`${bucket.member_user_id}:${bucket.currency}`] ??
			0;
		return count > inWindow;
	});
}

/** Σ owed amounts per currency (each bucket already rounded once). */
function owedTotals(owed: readonly OwedBucket[]): Record<string, number> {
	const totals: Record<string, number> = {};
	for (const bucket of owed) {
		totals[bucket.currency] = (totals[bucket.currency] ?? 0) + bucket.amount;
	}
	return totals;
}

function totalsLine(totals: Record<string, number>): string {
	const kept: Record<string, number> = {};
	for (const [currency, amount] of Object.entries(totals)) {
		if (amount > 0.005) kept[currency] = amount;
	}
	return joinMoneyLines(moneyLines(kept));
}

// ── Copy (web only: the app never renders this panel) ───────────────────────

export const TEAM_PAYOUTS_COPY = {
	toPayTitle: "To pay",
	toPaySubtitle: "Approved, unpaid time by pay cut-off, newest first.",
	outstanding: "Approved and unpaid",
	stepApprove: "Approve the cut-off's timesheets in Time",
	stepPay: "Pay the cut-off here once its time is approved",
	empty: "Nothing to pay. Approved, unpaid time shows up here by cut-off.",
	historyTitle: "Payout history",
	historyEmpty:
		"No payouts recorded yet. Pay someone above and the record shows up here with its method, reference and proof.",
	selfPayment: "Someone else on the team has to record your payment.",
	fixed: "Fixed-fee time is paid as a manual payment, not by entry.",
	windowFrom: (date: string) => `Showing cut-offs from ${date}.`,
	olderOwed: (date: string) =>
		`Some approved time from before ${date} isn't paid yet.`,
	showOlder: "Show older time",
	capped:
		"Showing the first 10,000 entries. Older time may be missing from these cut-offs.",
	planDetail: "Recorded payments stay readable here, and can still be voided.",
	voided: "Payout voided. Its time is approved and unpaid again.",
	unapproved: (seconds: number, count: number) =>
		seconds > 0
			? `${formatDurationText(seconds)} not yet approved`
			: `${count} ${count === 1 ? "entry" : "entries"} not yet approved`,
};

const METHOD_LABEL: Record<string, string> = {
	bank: "Bank",
	gcash: "GCash",
	maya: "Maya",
	paypal: "PayPal",
	other: "Other",
};

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
});

function formatDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "—" : DATE_FMT.format(date);
}

function payoutMemberLabel(p: Payout): string {
	return (
		p.member?.display_name ||
		[p.member?.first_name, p.member?.last_name]
			.filter(Boolean)
			.join(" ")
			.trim() ||
		p.member?.email ||
		p.member_user_id
	);
}

function initialsOf(name: string): string {
	const words = name
		.trim()
		.split(/\s+/)
		.filter((part) => /[\p{L}\p{N}]/u.test(part));
	const initials = words
		.map((part) => part.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
		.join("")
		.slice(0, 2)
		.toUpperCase();
	return initials || "?";
}

function Avatar({
	url,
	label,
	size = "md",
}: {
	url: string | null | undefined;
	label: string;
	size?: "sm" | "md";
}) {
	const box = size === "sm" ? "h-8 w-8 text-[11px]" : "h-9 w-9 text-xs";
	return url ? (
		<img
			src={url}
			alt=""
			className={`${box} shrink-0 rounded-full object-cover`}
		/>
	) : (
		<div
			aria-hidden="true"
			className={`${box} flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground`}
		>
			{initialsOf(label)}
		</div>
	);
}

// ── The panel ───────────────────────────────────────────────────────────────

/**
 * Team › Time › Payouts (and Engagements › Finance › team › Payouts): what the
 * team owes its members for approved time, grouped by pay cut-off, and the
 * payments recorded so far.
 *
 * Reads the team report (`/api/time/reports/entries?scope=team:<id>`) for the
 * entries and the owed balances (`/api/payouts/teams/:id/owed`) for the
 * all-time totals. A web surface: the app never shows payouts (L54).
 */
export function TeamPayoutsPanel(props: TeamPayoutsPanelProps) {
	if (isNativeApp()) {
		return <TimeReasonCard tone="neutral" title={NATIVE_FALLBACK_COPY} />;
	}
	return <TeamPayoutsPanelBody {...props} />;
}

interface PayTarget {
	row: PayoutMemberRow;
	group: PayoutCutoffGroup;
}

function TeamPayoutsPanelBody({ teamId, links }: TeamPayoutsPanelProps) {
	const qc = useQueryClient();
	const viewer = useUser();
	const openReport = links?.openReport;
	const access = useTeamMoneyAccess(teamId);
	const [openId, setOpenId] = useState<string | null>(null);
	const [payTarget, setPayTarget] = useState<PayTarget | null>(null);
	const [showAll, setShowAll] = useState(false);

	const config = access.team?.pay_period_config ?? null;
	// Cut-offs and owed dates are counted in the team's time zone (L65).
	const policyQuery = useQuery(timeQueries.teamPolicy(teamId));
	const zone = policyQuery.data
		? safeTimezone(policyQuery.data.effective.timezone)
		: policyQuery.isError
			? safeTimezone(deviceTimeZone())
			: null;
	const today = zone ? todayIn(zone) : null;
	const windowFrom = showAll
		? PAYOUT_HISTORY_FLOOR
		: today
			? defaultPayoutWindowFrom(today)
			: null;
	const windowTo = today ? addDays(today, 1) : null;

	// Recording and owed need time_payouts; history and void never do. Wait
	// for the plan answer so a plan without it never fires the owed read (and
	// with it the app-wide upgrade prompt).
	const planKnown = access.planStatus !== "loading";
	const planBlocked = access.payoutsPlanLimit !== null;
	const canSettle = planKnown && !planBlocked;

	const entriesQuery = useQuery({
		// Under ["time","reports"], so every time event that moves approved or
		// paid time (entry, sheet, payout) refreshes it.
		queryKey: ["time", "reports", "team-payouts", teamId, windowFrom, windowTo],
		queryFn: () =>
			listAllReportEntries(
				{
					scope: { kind: "team", id: teamId },
					from: windowFrom as string,
					to: windowTo as string,
				},
				{ maxItems: PAYOUT_ENTRY_CAP },
			),
		enabled: canSettle && Boolean(windowFrom && windowTo),
		retry: retryTimeQuery,
		refetchOnMount: true,
	});
	const owedQuery = useQuery({
		queryKey: ["payouts", teamId, "owed"],
		queryFn: () => payoutsService.getTeamOwed(teamId),
		enabled: canSettle,
		retry: retryTimeQuery,
		refetchOnMount: true,
	});
	const payoutsQuery = useQuery({
		queryKey: ["payouts", teamId, "list"],
		queryFn: () => payoutsService.listTeamPayouts(teamId),
		retry: retryTimeQuery,
		refetchOnMount: true,
	});
	const payouts = payoutsQuery.data ?? [];

	const slice = useMemo<PayoutWindow | null>(
		() =>
			entriesQuery.data && zone && today
				? buildPayoutWindow(entriesQuery.data, {
						config,
						timezone: zone,
						today,
					})
				: null,
		[entriesQuery.data, zone, today, config],
	);
	const olderOwed =
		!showAll && slice && owedQuery.data
			? owedOutsideWindow(owedQuery.data, slice)
			: false;
	const capped = (entriesQuery.data?.length ?? 0) >= PAYOUT_ENTRY_CAP;
	const grandTotal = owedQuery.data
		? totalsLine(owedTotals(owedQuery.data))
		: slice
			? totalsLine(slice.totalsByCurrency)
			: "";

	const settleError = entriesQuery.error ?? owedQuery.error ?? null;
	const settleLoading =
		!planKnown ||
		(!planBlocked &&
			(!zone || entriesQuery.isPending || owedQuery.isPending) &&
			!settleError);

	let toPay: ReactNode;
	if (planKnown && access.payoutsPlanLimit) {
		toPay = (
			<PlanLimitNotice
				info={access.payoutsPlanLimit}
				workspace={access.planWorkspace}
				isComplimentary={access.isComplimentary}
				message={timePlanCopy("time_payouts")}
				detail={TEAM_PAYOUTS_COPY.planDetail}
			/>
		);
	} else if (settleError) {
		toPay = (
			<FinanceQueryError
				error={settleError}
				scope="team"
				onRetry={() => {
					void entriesQuery.refetch();
					void owedQuery.refetch();
				}}
			/>
		);
	} else if (settleLoading || !slice) {
		toPay = (
			<div className="flex justify-center py-8">
				<Loader2
					className="h-5 w-5 animate-spin text-muted-foreground"
					aria-label="Loading"
				/>
			</div>
		);
	} else {
		const fromLabel = windowFrom
			? formatLocalDay(windowFrom, { year: "always" })
			: "";
		toPay = (
			<>
				{slice.groups.length === 0 ? (
					<div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
						{TEAM_PAYOUTS_COPY.empty}
					</div>
				) : (
					slice.groups.map((g) => (
						<CutoffSection
							key={g.key}
							group={g}
							viewerId={viewer?.id ?? null}
							onPay={(row) => setPayTarget({ row, group: g })}
							onReview={
								openReport
									? (row) =>
											openReport({
												person: row.memberId,
												from: g.from,
												to: g.to,
											})
									: undefined
							}
						/>
					))
				)}
				{slice.fixedCount > 0 ? (
					<p className="text-[11px] text-muted-foreground">
						{TEAM_PAYOUTS_COPY.fixed}
					</p>
				) : null}
				{capped ? (
					<p className="text-[11px] text-warning">{TEAM_PAYOUTS_COPY.capped}</p>
				) : null}
				{!showAll ? (
					<div
						className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-[11px] ${
							olderOwed
								? "border border-warning/30 bg-warning/10 text-foreground"
								: "bg-muted text-muted-foreground"
						}`}
						role={olderOwed ? "status" : undefined}
					>
						<span>
							{olderOwed
								? TEAM_PAYOUTS_COPY.olderOwed(fromLabel)
								: TEAM_PAYOUTS_COPY.windowFrom(fromLabel)}
						</span>
						<button
							type="button"
							onClick={() => setShowAll(true)}
							className="font-semibold text-primary hover:underline"
						>
							{TEAM_PAYOUTS_COPY.showOlder}
						</button>
					</div>
				) : null}
			</>
		);
	}

	return (
		<div className="space-y-4">
			{/* ─── To pay: Owed balances grouped by cut-off ───────────────── */}
			<section className="rounded-xl border border-border bg-card p-4 shadow-sm">
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<div>
						<h3 className="text-sm font-semibold text-foreground">
							{TEAM_PAYOUTS_COPY.toPayTitle}
						</h3>
						<p className="text-xs text-muted-foreground">
							{TEAM_PAYOUTS_COPY.toPaySubtitle}
						</p>
					</div>
					{grandTotal && !planBlocked ? (
						<div className="text-right">
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
								{TEAM_PAYOUTS_COPY.outstanding}
							</div>
							<div
								className="text-sm font-semibold tabular-nums text-foreground"
								data-testid="payouts-outstanding"
							>
								{grandTotal}
							</div>
						</div>
					) : null}
				</div>

				{/* The two steps: approval happens on timesheets, payment here. */}
				<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground">
					<span className="inline-flex items-center gap-1.5">
						<ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
						<span className="font-semibold text-foreground">1.</span>{" "}
						{TEAM_PAYOUTS_COPY.stepApprove}
					</span>
					<span className="inline-flex items-center gap-1.5">
						<Wallet className="h-3.5 w-3.5" aria-hidden="true" />
						<span className="font-semibold text-foreground">2.</span>{" "}
						{TEAM_PAYOUTS_COPY.stepPay}
					</span>
				</div>

				<div className="mt-3 space-y-3">{toPay}</div>
			</section>

			{/* ─── Paid history ──────────────────────────────────────────────── */}
			<section className="rounded-xl border border-border bg-card">
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<h3 className="text-sm font-semibold text-foreground">
						{TEAM_PAYOUTS_COPY.historyTitle}
					</h3>
					{payouts.length > 0 && (
						<span className="text-xs text-muted-foreground">
							{payouts.length} record{payouts.length === 1 ? "" : "s"}
						</span>
					)}
				</div>
				{payoutsQuery.isPending ? (
					<div className="flex justify-center p-12">
						<Loader2
							className="h-6 w-6 animate-spin text-muted-foreground"
							aria-label="Loading"
						/>
					</div>
				) : payoutsQuery.isError ? (
					<FinanceQueryError
						className="p-4"
						error={payoutsQuery.error}
						scope="team"
						onRetry={() => void payoutsQuery.refetch()}
					/>
				) : payouts.length === 0 ? (
					<div className="px-6 py-12 text-center text-sm text-muted-foreground">
						{TEAM_PAYOUTS_COPY.historyEmpty}
					</div>
				) : (
					<ul className="divide-y divide-border">
						{payouts.map((p) => (
							<PayoutHistoryRow
								key={p.id}
								payout={p}
								onOpen={() => setOpenId(p.id)}
							/>
						))}
					</ul>
				)}
			</section>

			{payTarget && payTarget.row.currency ? (
				<PayMemberModal
					isOpen
					teamId={teamId}
					memberId={payTarget.row.memberId}
					memberLabel={payTarget.row.label}
					currency={payTarget.row.currency}
					entries={payTarget.row.entries}
					payPeriodConfig={config}
					timezone={zone}
					unapprovedSeconds={payTarget.row.unapprovedSeconds}
					onClose={() => setPayTarget(null)}
					onSuccess={() => {
						setPayTarget(null);
						void qc.invalidateQueries({ queryKey: ["payouts", teamId] });
					}}
				/>
			) : null}

			<PayoutDetailDrawer
				teamId={teamId}
				payoutId={openId}
				onClose={() => setOpenId(null)}
			/>
		</div>
	);
}

function PayoutHistoryRow({
	payout: p,
	onOpen,
}: {
	payout: Payout;
	onOpen: () => void;
}) {
	const label = payoutMemberLabel(p);
	const isVoid = p.status === "void";
	return (
		<li>
			<button
				type="button"
				onClick={onOpen}
				className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted"
			>
				<Avatar url={p.member?.avatar_url} label={label} />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span
							className={`truncate text-sm font-medium ${isVoid ? "text-muted-foreground line-through" : "text-foreground"}`}
						>
							{label}
						</span>
						<span
							className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
								isVoid
									? "bg-muted text-muted-foreground"
									: "bg-success/10 text-success"
							}`}
						>
							{isVoid ? "Void" : "Paid"}
						</span>
					</div>
					<div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
						<span>{formatDate(p.paid_at)}</span>
						{p.method_type && (
							<>
								<span aria-hidden="true">·</span>
								<span>
									{METHOD_LABEL[p.method_type] ?? p.method_type}
									{p.method_label ? ` · ${p.method_label}` : ""}
								</span>
							</>
						)}
						{p.reference_number && (
							<>
								<span aria-hidden="true">·</span>
								<span className="truncate">Ref {p.reference_number}</span>
							</>
						)}
					</div>
				</div>
				<div
					className={`shrink-0 text-right text-sm font-semibold tabular-nums ${isVoid ? "text-muted-foreground line-through" : "text-success"}`}
				>
					{formatMoneyLine(p.total_amount, p.currency)}
				</div>
				<ExternalLink
					className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
			</button>
		</li>
	);
}

function CutoffSection({
	group,
	viewerId,
	onPay,
	onReview,
}: {
	group: PayoutCutoffGroup;
	viewerId: string | null;
	onPay: (row: PayoutMemberRow) => void;
	/** Omitted when the host gives no way to reach the team Report. */
	onReview?: (row: PayoutMemberRow) => void;
}) {
	const hasUnapproved = group.unapprovedCount > 0;

	// One chip that says where this cut-off stands.
	const chip = hasUnapproved
		? {
				cls: "bg-warning/15 text-warning",
				icon: <ClipboardCheck className="h-3 w-3" aria-hidden="true" />,
				text: TEAM_PAYOUTS_COPY.unapproved(
					group.unapprovedSeconds,
					group.unapprovedCount,
				),
			}
		: group.overdue
			? {
					cls: "bg-destructive/10 text-destructive",
					icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
					text: "Overdue",
				}
			: group.inProgress
				? {
						cls: "bg-muted text-muted-foreground",
						icon: <Hourglass className="h-3 w-3" aria-hidden="true" />,
						text: "In progress",
					}
				: {
						cls: "bg-success/10 text-success",
						icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />,
						text: "Ready to pay",
					};
	const payDay = formatLocalDay(group.payDate, { year: "auto" });

	return (
		<div
			className={`overflow-hidden rounded-xl border ${hasUnapproved ? "border-warning/40" : "border-border"}`}
		>
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/60 px-3 py-2">
				<div className="flex flex-wrap items-center gap-2">
					<CalendarClock
						className="h-4 w-4 text-muted-foreground"
						aria-hidden="true"
					/>
					<span className="text-sm font-semibold text-foreground">
						{group.label}
					</span>
					<span className="text-[11px] text-muted-foreground">
						{group.overdue ? "was due" : "pays"} {payDay}
					</span>
				</div>
				<span
					className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.cls}`}
				>
					{chip.icon}
					{chip.text}
				</span>
			</div>

			<ul className="divide-y divide-border">
				{group.rows.map((row) => {
					const isSelf = viewerId !== null && row.memberId === viewerId;
					const meta: string[] = [];
					if (row.entries.length > 0) {
						meta.push(
							`${formatClock(row.seconds)} approved · ${row.entries.length} ${row.entries.length === 1 ? "entry" : "entries"}`,
						);
						if (row.amount <= 0) meta.push("no rate in force");
					}
					return (
						<li
							key={row.key}
							className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
						>
							<div className="flex min-w-0 items-center gap-2.5">
								<Avatar url={row.avatarUrl} label={row.label} size="sm" />
								<div className="min-w-0">
									<div className="truncate text-sm font-medium text-foreground">
										{row.label}
									</div>
									<div className="text-[11px] tabular-nums text-muted-foreground">
										{meta.join(" · ")}
										{row.unapprovedCount > 0 ? (
											<span className="text-warning">
												{meta.length > 0 ? " · " : ""}
												{TEAM_PAYOUTS_COPY.unapproved(
													row.unapprovedSeconds,
													row.unapprovedCount,
												)}
											</span>
										) : null}
									</div>
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								{row.unapprovedCount > 0 && onReview ? (
									<button
										type="button"
										onClick={() => onReview(row)}
										className="inline-flex items-center gap-1.5 rounded-lg border border-warning/40 bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-warning/10"
									>
										<ClipboardCheck
											className="h-3.5 w-3.5"
											aria-hidden="true"
										/>
										Review
									</button>
								) : null}
								{row.amount > 0 && row.currency ? (
									<button
										type="button"
										onClick={() => onPay(row)}
										disabled={isSelf}
										title={isSelf ? TEAM_PAYOUTS_COPY.selfPayment : undefined}
										className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
									>
										<Wallet className="h-3.5 w-3.5" aria-hidden="true" />
										Pay {formatMoneyLine(row.amount, row.currency)}
									</button>
								) : null}
							</div>
							{isSelf && row.amount > 0 ? (
								<p className="w-full text-[11px] text-muted-foreground">
									{TEAM_PAYOUTS_COPY.selfPayment}
								</p>
							) : null}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function PayoutDetailDrawer({
	teamId,
	payoutId,
	onClose,
}: {
	teamId: string;
	payoutId: string | null;
	onClose: () => void;
}) {
	const toast = useToast();
	const qc = useQueryClient();

	const detailQuery = useQuery({
		queryKey: ["payout", payoutId],
		queryFn: () => payoutsService.getPayout(payoutId as string),
		enabled: Boolean(payoutId),
		retry: retryTimeQuery,
	});

	const voidMutation = useMutation({
		mutationFn: (id: string) => payoutsService.voidPayout(id),
		onSuccess: (_payout, id) => {
			toast.success(TEAM_PAYOUTS_COPY.voided);
			void invalidateTime(qc, "payout");
			void qc.invalidateQueries({ queryKey: ["payouts", teamId] });
			void qc.invalidateQueries({ queryKey: ["payout", id] });
		},
		onError: (e: unknown) =>
			toast.error(
				timeErrorMessage(e, { subject: "entry", operation: "write" }),
			),
	});

	const payout = detailQuery.data;
	const entries = payout ? payoutEntries(payout) : [];

	return (
		<AppDialog
			open={Boolean(payoutId)}
			onClose={onClose}
			busy={voidMutation.isPending}
			variant="drawer-right"
			size="md"
			title={
				<span className="flex items-center gap-2">
					<Wallet className="h-4 w-4 text-primary" aria-hidden="true" />
					Payout detail
				</span>
			}
		>
			{detailQuery.isError ? (
				<FinanceQueryError
					error={detailQuery.error}
					scope="team"
					onRetry={() => void detailQuery.refetch()}
				/>
			) : detailQuery.isPending || !payout ? (
				<div className="flex flex-1 items-center justify-center py-12">
					<Loader2
						className="h-6 w-6 animate-spin text-muted-foreground"
						aria-label="Loading"
					/>
				</div>
			) : (
				<div className="space-y-4">
					<div className="rounded-xl border border-border bg-muted p-4">
						<div className="text-2xl font-bold tabular-nums text-success">
							{formatMoneyLine(payout.total_amount, payout.currency)}
						</div>
						<div className="mt-1 text-xs text-muted-foreground">
							Paid to {payoutMemberLabel(payout)} on{" "}
							{formatDate(payout.paid_at)}
						</div>
					</div>

					<dl className="space-y-2 text-xs">
						<DetailRow label="Method">
							{payout.method_type
								? `${METHOD_LABEL[payout.method_type] ?? payout.method_type}${payout.method_label ? ` · ${payout.method_label}` : ""}`
								: "—"}
						</DetailRow>
						<DetailRow label="Account">
							{payout.method_account_name
								? `${payout.method_account_name}${payout.method_account_identifier ? ` · ${payout.method_account_identifier}` : ""}`
								: "—"}
						</DetailRow>
						<DetailRow label="Reference">
							{payout.reference_number || "—"}
						</DetailRow>
						<DetailRow label="Note">{payout.note || "—"}</DetailRow>
						<DetailRow label="Status">
							{payout.status === "void" ? "Void" : "Paid"}
						</DetailRow>
					</dl>

					{payout.proof_path && (
						<ProofPreview payoutId={payout.id} proofPath={payout.proof_path} />
					)}

					<div>
						<div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
							Time in this payout ({entries.length})
						</div>
						<div className="divide-y divide-border rounded-lg border border-border">
							{entries.map((entry) => (
								<div
									key={entry.id}
									className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
								>
									<span className="min-w-0 truncate text-foreground">
										{entry.task?.title || entry.project?.title || "Time entry"}
									</span>
									<span className="shrink-0 tabular-nums text-muted-foreground">
										{formatClock(
											entry.payable_seconds ?? entry.duration_seconds,
										)}
									</span>
								</div>
							))}
						</div>
					</div>

					{payout.status === "recorded" && (
						<button
							type="button"
							onClick={() => voidMutation.mutate(payout.id)}
							disabled={voidMutation.isPending}
							className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/15 disabled:opacity-50"
						>
							{voidMutation.isPending ? (
								<Loader2
									className="h-3.5 w-3.5 animate-spin"
									aria-hidden="true"
								/>
							) : (
								<Ban className="h-3.5 w-3.5" aria-hidden="true" />
							)}
							Void payout
						</button>
					)}
				</div>
			)}
		</AppDialog>
	);
}

function ProofPreview({
	payoutId,
	proofPath,
}: {
	payoutId: string;
	proofPath: string;
}) {
	const isPdf = proofPath.toLowerCase().endsWith(".pdf");
	const urlQuery = useQuery({
		queryKey: ["payout-proof", payoutId],
		queryFn: () => payoutsService.getProofUrl(payoutId),
		staleTime: 4 * 60 * 1000, // presigned URLs are short-lived; refetch periodically
	});

	return (
		<div className="space-y-1.5">
			<div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
				Proof
			</div>
			{urlQuery.isPending ? (
				<div className="flex h-40 items-center justify-center rounded-lg border border-border bg-muted">
					<Loader2
						className="h-5 w-5 animate-spin text-muted-foreground"
						aria-label="Loading"
					/>
				</div>
			) : urlQuery.isError || !urlQuery.data ? (
				<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
					Couldn't load the proof file.
				</div>
			) : isPdf ? (
				<a
					href={urlQuery.data}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
				>
					<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
					Open PDF proof
				</a>
			) : (
				<a
					href={urlQuery.data}
					target="_blank"
					rel="noopener noreferrer"
					title="Open full size"
					className="group block overflow-hidden rounded-lg border border-border bg-muted"
				>
					<img
						src={urlQuery.data}
						alt="Payment proof"
						className="max-h-72 w-full object-contain transition-opacity group-hover:opacity-90"
					/>
				</a>
			)}
		</div>
	);
}

function DetailRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex justify-between gap-4">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="text-right font-medium text-foreground">{children}</dd>
		</div>
	);
}
