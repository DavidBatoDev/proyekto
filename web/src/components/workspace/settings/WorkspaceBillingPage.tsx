import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
	AlertTriangle,
	BadgeCheck,
	CircleCheck,
	CreditCard,
	ExternalLink,
	Gauge,
	Info,
	Loader2,
	Lock,
	Mail,
	ReceiptText,
} from "lucide-react";
import { useEffect, useState } from "react";
import { SemanticBadge } from "@/components/common/SemanticBadge";
import {
	SettingsHeadline,
	SettingsNotice,
	SettingsPageHeader,
	SettingsRow,
	SettingsRows,
	SettingsSection,
	SettingsSkeleton,
	SettingsStat,
	SettingsStats,
	settingsButton,
} from "@/components/workspace/settings/SettingsPrimitives";
import { WorkspaceSettingsGate } from "@/components/workspace/settings/WorkspaceSettingsGate";
import {
	useBillingSummaryQuery,
	useCreateCheckoutSessionMutation,
	useCreatePortalSessionMutation,
	useInvalidateBilling,
} from "@/hooks/useBilling";
import { useWorkspaceInvitesQuery } from "@/hooks/useWorkspaceQueries";
import {
	ADMIN_READ_ONLY_NOTE,
	billingStatusCopy,
	CHECKOUT_CANCELLED,
	CHECKOUT_SETTLING,
	CHECKOUT_SLOW,
	COMPLIMENTARY_NOTE,
	COMPLIMENTARY_PLAN_CHANGES_NOTE,
	COMPLIMENTARY_WITH_SUBSCRIPTION_NOTE,
	MEMBER_ONLY_NOTE,
	PENDING_INVITES_NOTE,
	SALES_EMAIL,
	seatsCopy,
} from "@/lib/billingCopy";
import { planLabel } from "@/lib/planLimits";
import { PLANS } from "@/lib/pricing";
import { COMPLIMENTARY_BADGE } from "@/lib/usageCopy";
import type { BillingSummary } from "@/services/billing.service";
import type { Workspace } from "@/services/workspaces.service";

/**
 * Where the owner's plan controls stand. A plan Proyekto granted
 * ("complimentary") is never sold over: with no subscription behind it the
 * owner talks to us, and with one still running they can only manage (or
 * cancel) that subscription. A checkout there would sell a plan the
 * workspace already gets. Only checkout is withheld: whenever the workspace
 * has a billing account (`portal_available`), the owner keeps the portal for
 * invoices and the saved payment method, comped or not.
 */
export type OwnerBillingMode =
	| "complimentary"
	| "complimentary_with_subscription"
	| "portal"
	| "checkout";

export function ownerBillingMode(
	summary: Pick<
		BillingSummary,
		"plan_source" | "has_live_subscription" | "portal_available"
	>,
): OwnerBillingMode {
	if (summary.plan_source === "complimentary") {
		return summary.has_live_subscription === true
			? "complimentary_with_subscription"
			: "complimentary";
	}
	return summary.portal_available ? "portal" : "checkout";
}

export function WorkspaceBillingPage() {
	return (
		<WorkspaceSettingsGate>
			{(workspace) => <BillingContent workspace={workspace} />}
		</WorkspaceSettingsGate>
	);
}

/** Muted leading icon for a settings row; the row centres it on the label's line. */
const rowIcon = "h-4 w-4 shrink-0 text-muted-foreground";

const MANAGE_DESCRIPTION = "Changes to the plan and payment method.";

function BillingContent({ workspace }: { workspace: Workspace }) {
	const isOwner = workspace.my_role === "owner";
	const canManage = isOwner || workspace.my_role === "admin";

	// A plain member cannot read the subscription at all (RLS and the API agree
	// on that), so don't fire a request that would only raise the global 403
	// toast on an otherwise healthy page.
	const summaryQuery = useBillingSummaryQuery(canManage ? workspace.id : null);

	return (
		<div className="app-fade-in">
			<SettingsPageHeader
				title="Billing"
				description="The plan and seats for this workspace."
				actions={<UsageLink workspace={workspace} />}
			/>

			{!canManage ? (
				<div className="py-8">
					<SettingsNotice icon={Lock}>{MEMBER_ONLY_NOTE}</SettingsNotice>
				</div>
			) : summaryQuery.isLoading ? (
				<SettingsSkeleton bands={3} />
			) : summaryQuery.data ? (
				<ManagerView
					workspace={workspace}
					summary={summaryQuery.data}
					isOwner={isOwner}
				/>
			) : (
				<div className="py-8">
					<SettingsNotice tone="warning" icon={AlertTriangle}>
						Billing details are unavailable right now. Try again in a moment.
					</SettingsNotice>
				</div>
			)}
		</div>
	);
}

function ManagerView({
	workspace,
	summary,
	isOwner,
}: {
	workspace: Workspace;
	summary: BillingSummary;
	isOwner: boolean;
}) {
	const invitesQuery = useWorkspaceInvitesQuery(workspace.id);
	const pendingInvites = (invitesQuery.data ?? []).filter(
		(invite) => invite.status === "pending",
	).length;

	const seats = seatsCopy(summary.seats_used, summary.billed_quantity);
	const status = billingStatusCopy(summary, formatDate);
	// The plan the workspace gets, which a granted plan can lift above the one
	// being paid for. An older backend sends neither field: fall back to `plan`.
	const effectivePlan = summary.effective_plan ?? summary.plan;
	const isComplimentary = summary.plan_source === "complimentary";
	const complimentaryUntil =
		isComplimentary && summary.complimentary?.until
			? formatDate(summary.complimentary.until)
			: null;
	// Only ever a link to the provider's hosted page; anything that is not
	// plain https is not rendered as an href.
	const invoiceUrl =
		isOwner &&
		summary.latest_invoice?.hosted_url &&
		/^https:\/\//i.test(summary.latest_invoice.hosted_url)
			? summary.latest_invoice.hosted_url
			: null;
	const showPayment = Boolean(
		summary.payment_method || summary.billing_email || invoiceUrl,
	);

	return (
		<div>
			<CheckoutReturnBanner />

			{status ? (
				<SettingsNotice
					className="mt-6"
					tone={status.tone === "warning" ? "danger" : "info"}
					icon={status.tone === "warning" ? AlertTriangle : Info}
				>
					{status.message}
				</SettingsNotice>
			) : null}

			<SettingsSection
				id="billing-plan"
				title="Plan"
				description="What this workspace is on today."
			>
				<SettingsHeadline
					value={planLabel(effectivePlan)}
					// The interval belongs to the paid subscription, which is not
					// what a granted plan is.
					aside={
						summary.interval && !isComplimentary
							? `billed ${summary.interval === "year" ? "yearly" : "monthly"}`
							: undefined
					}
					badge={
						isComplimentary ? (
							<SemanticBadge icon={BadgeCheck} iconClassName="text-success">
								{COMPLIMENTARY_BADGE}
							</SemanticBadge>
						) : null
					}
				>
					{isComplimentary ? (
						<>
							{summary.has_live_subscription
								? COMPLIMENTARY_WITH_SUBSCRIPTION_NOTE
								: COMPLIMENTARY_NOTE}
							{complimentaryUntil ? ` Until ${complimentaryUntil}.` : null}
						</>
					) : null}
				</SettingsHeadline>
			</SettingsSection>

			<SettingsSection
				id="billing-seats"
				title="Seats and invoices"
				description="Seat counts, and the next invoice when there is one."
			>
				{/* seat_limit is deliberately never rendered: it is the payment
				    provider's seat-cap column, not the plan's member limit.
				    Member caps live in the plan-limit matrix and are shown, with
				    the other limits, on the Usage page. */}
				{/* Two columns: some counts carry sentences as hints, which a
				    third column would squeeze into ribbons. */}
				<SettingsStats className="sm:grid-cols-2">
					<SettingsStat label="Seats in use" value={summary.seats_used} />
					{/* Two numbers when the DB and the provider disagree, which they
					    legitimately do between a membership change and the next
					    sync. */}
					{summary.billed_quantity !== null ? (
						<SettingsStat
							label="Seats billed"
							value={summary.billed_quantity}
							hint={seats.note ?? undefined}
						/>
					) : null}
					{summary.next_invoice ? (
						<SettingsStat
							label="Next invoice"
							value={formatMoney(
								summary.next_invoice.amount_due_cents,
								summary.next_invoice.currency,
							)}
							hint={
								summary.next_invoice.date
									? `Estimated, on ${formatDate(summary.next_invoice.date)}`
									: "Estimated"
							}
						/>
					) : null}
					{/* Invites sit with the seat counts because they are the seats
					    still to come, and are read the same way. */}
					<SettingsStat label="Invited" value={pendingInvites} />
				</SettingsStats>
				{/* One caption under the whole row rather than a hint on the
				    invite count alone, which left "Seats in use" a lone figure
				    beside a paragraph. */}
				<p className="mt-4 text-xs leading-relaxed text-muted-foreground">
					{PENDING_INVITES_NOTE}
				</p>
			</SettingsSection>

			{showPayment ? (
				<SettingsSection
					id="billing-payment"
					title="Payment"
					description="How this workspace pays and where receipts go."
				>
					<SettingsRows>
						{/* Card digits are an owner's business. An admin sees only that a
						    card exists, because an owner can promote anyone to admin in one
						    request. */}
						<SettingsRow
							label="Payment method"
							leading={<CreditCard aria-hidden="true" className={rowIcon} />}
						>
							{summary.payment_method ? (
								isOwner ? (
									<div className="sm:text-right">
										<p className="text-foreground">
											{capitalize(summary.payment_method.brand ?? "Card")}{" "}
											ending{" "}
											<span className="tabular-nums">
												{summary.payment_method.last4 ?? "----"}
											</span>
										</p>
										{cardExpiry(summary.payment_method) ? (
											<p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
												Expires {cardExpiry(summary.payment_method)}
											</p>
										) : null}
									</div>
								) : (
									<span className="text-muted-foreground">
										A payment method is on file.
									</span>
								)
							) : (
								<span className="text-muted-foreground">
									No payment method on file.
								</span>
							)}
						</SettingsRow>
						{summary.billing_email ? (
							<SettingsRow
								label="Receipts"
								leading={<Mail aria-hidden="true" className={rowIcon} />}
							>
								<span className="break-all text-foreground">
									{summary.billing_email}
								</span>
							</SettingsRow>
						) : null}
						{invoiceUrl ? (
							<SettingsRow
								label="Latest invoice"
								leading={<ReceiptText aria-hidden="true" className={rowIcon} />}
							>
								<a
									href={invoiceUrl}
									target="_blank"
									rel="noopener noreferrer"
									className={settingsButton.link}
								>
									View invoice
									<ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
								</a>
							</SettingsRow>
						) : null}
					</SettingsRows>
				</SettingsSection>
			) : null}

			{isOwner ? (
				<OwnerActions workspace={workspace} summary={summary} />
			) : (
				<SettingsSection
					id="billing-manage"
					title="Manage"
					description={MANAGE_DESCRIPTION}
				>
					<SettingsNotice icon={Lock}>{ADMIN_READ_ONLY_NOTE}</SettingsNotice>
				</SettingsSection>
			)}
		</div>
	);
}

function OwnerActions({
	workspace,
	summary,
}: {
	workspace: Workspace;
	summary: BillingSummary;
}) {
	const checkout = useCreateCheckoutSessionMutation(workspace.id);
	const portal = useCreatePortalSessionMutation(workspace.id);
	const [error, setError] = useState<string | null>(null);
	const mode = ownerBillingMode(summary);
	// A comped owner changes plans through us, except while a subscription of
	// their own is still running and its portal can manage it. The portal
	// itself turns on `portal_available` alone (never true in "checkout"), so
	// a comped workspace with an ended subscription keeps its invoices and
	// saved card; only checkout is suppressed under a comp.
	const showSalesNote =
		mode === "complimentary" ||
		(mode === "complimentary_with_subscription" && !summary.portal_available);

	const purchasable = PLANS.filter(
		(plan) =>
			plan.cta.kind === "subscribe" &&
			summary.purchasable_plans.includes(plan.id as "pro" | "business"),
	);

	async function go(promise: Promise<{ url: string }>) {
		setError(null);
		try {
			const { url } = await promise;
			// A full navigation, not a router navigate: the provider's hosted page is another origin.
			window.location.assign(url);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}

	const errorLine = error ? (
		<p role="alert" className="mt-4 text-sm text-destructive">
			{error}
		</p>
	) : null;

	// "checkout" is only ever reached without a portal (see ownerBillingMode).
	if (mode === "checkout") {
		return (
			<SettingsSection
				id="billing-manage"
				title="Choose a plan"
				description="Start a subscription for this workspace. You'll be billed for each member."
			>
				{purchasable.length > 0 ? (
					<SettingsRows as="ul">
						{purchasable.map((plan) => (
							<SettingsRow
								as="li"
								key={plan.id}
								label={plan.name}
								description={plan.tagline}
							>
								{plan.intervals.map((interval) => {
									const pending =
										checkout.isPending &&
										checkout.variables?.plan === plan.id &&
										checkout.variables?.interval === interval;
									return (
										<button
											key={`${plan.id}-${interval}`}
											type="button"
											// The row already names the plan; the button's name
											// still carries it so it reads alone.
											aria-label={`${plan.name} · ${
												interval === "year" ? "billed yearly" : "monthly"
											}`}
											className={settingsButton.secondary}
											disabled={checkout.isPending}
											onClick={() =>
												go(
													checkout.mutateAsync({
														plan: plan.id as "pro" | "business",
														interval,
													}),
												)
											}
										>
											{pending ? (
												<Loader2
													aria-hidden="true"
													className="h-4 w-4 animate-spin"
												/>
											) : null}
											{interval === "year" ? "Yearly" : "Monthly"}
										</button>
									);
								})}
							</SettingsRow>
						))}
					</SettingsRows>
				) : (
					<p className="text-sm text-muted-foreground">
						No plans are available for purchase on this environment.
					</p>
				)}
				{errorLine}
			</SettingsSection>
		);
	}

	return (
		<SettingsSection
			id="billing-manage"
			title="Manage"
			description={MANAGE_DESCRIPTION}
		>
			<SettingsRows>
				{showSalesNote ? (
					<SettingsRow
						label="Plan changes"
						leading={<Mail aria-hidden="true" className={rowIcon} />}
						description={
							<>
								{COMPLIMENTARY_PLAN_CHANGES_NOTE} Contact{" "}
								<a
									href={`mailto:${SALES_EMAIL}`}
									className="font-medium text-primary hover:underline"
								>
									{SALES_EMAIL}
								</a>
								.
							</>
						}
					/>
				) : null}
				{summary.portal_available ? (
					<SettingsRow
						label="Billing portal"
						leading={<CreditCard aria-hidden="true" className={rowIcon} />}
						description={
							mode === "portal"
								? "Change plan, update your payment method, or download invoices."
								: summary.has_live_subscription
									? "Update your payment method, cancel your subscription, or download invoices."
									: "Update your saved payment method or download past invoices."
						}
					>
						<button
							type="button"
							className={settingsButton.primary}
							disabled={portal.isPending}
							onClick={() => go(portal.mutateAsync({}))}
						>
							{portal.isPending ? (
								<Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
							) : (
								<ExternalLink aria-hidden="true" className="h-4 w-4" />
							)}
							Manage billing
						</button>
					</SettingsRow>
				) : null}
			</SettingsRows>
			{errorLine}
		</SettingsSection>
	);
}

/** Limits and how much of each is used live on their own page. */
function UsageLink({ workspace }: { workspace: Workspace }) {
	return (
		<Link
			to="/w/$workspaceSlug/settings/usage"
			params={{ workspaceSlug: workspace.slug }}
			className={settingsButton.secondary}
		>
			<Gauge className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
			See usage
		</Link>
	);
}

/**
 * The provider returns the browser before the webhook has necessarily been processed,
 * so `?checkout=success` is a hint, not a fact. Poll briefly, then reassure —
 * never show a failure, because the money has already moved.
 */
function CheckoutReturnBanner() {
	const search = useSearch({ strict: false }) as { checkout?: string };
	const navigate = useNavigate();
	const invalidate = useInvalidateBilling();
	const [slow, setSlow] = useState(false);

	useEffect(() => {
		if (search.checkout !== "success") return;
		let settled = false;
		const poll = setInterval(() => {
			invalidate();
		}, 2000);
		const giveUp = setTimeout(() => {
			if (!settled) setSlow(true);
		}, 20_000);
		const clear = setTimeout(() => {
			settled = true;
			// Strip the param so a refresh or a back-button press does not replay
			// the "payment received" state.
			void navigate({ to: ".", search: () => ({}), replace: true });
		}, 20_000);
		return () => {
			clearInterval(poll);
			clearTimeout(giveUp);
			clearTimeout(clear);
		};
	}, [search.checkout, invalidate, navigate]);

	if (search.checkout === "cancelled") {
		return (
			<SettingsNotice className="mt-6" tone="info" icon={Info} role="status">
				{CHECKOUT_CANCELLED}
			</SettingsNotice>
		);
	}
	if (search.checkout !== "success") return null;

	return (
		<SettingsNotice
			className="mt-6"
			tone="success"
			icon={CircleCheck}
			role="status"
		>
			{slow ? CHECKOUT_SLOW : CHECKOUT_SETTLING}
		</SettingsNotice>
	);
}

function formatDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleDateString(undefined, {
		day: "numeric",
		month: "long",
		year: "numeric",
	});
}

/** "visa" from the provider reads as "Visa" on the page. */
function capitalize(value: string): string {
	return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** MM/YYYY, or null when the provider did not report both parts. */
function cardExpiry(method: NonNullable<BillingSummary["payment_method"]>) {
	if (method.exp_month === null || method.exp_year === null) return null;
	return `${String(method.exp_month).padStart(2, "0")}/${method.exp_year}`;
}

/**
 * Formats from the currency the provider reported. Never assume "$": the amount and
 * its currency travel together precisely so a non-USD account is not mislabelled.
 */
function formatMoney(cents: number, currency: string): string {
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency: currency.toUpperCase(),
		}).format(cents / 100);
	} catch {
		return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
	}
}
