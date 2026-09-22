import { useNavigate, useSearch } from "@tanstack/react-router";
import { AlertTriangle, CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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
	MEMBER_ONLY_NOTE,
	PENDING_INVITES_NOTE,
	seatsCopy,
} from "@/lib/billingCopy";
import { PLANS, type PlanId } from "@/lib/pricing";
import type { BillingSummary } from "@/services/billing.service";
import type { Workspace } from "@/services/workspaces.service";

const PLAN_LABEL: Record<PlanId, string> = {
	free: "Free",
	pro: "Pro",
	business: "Business",
	enterprise: "Enterprise",
};

export function WorkspaceBillingPage() {
	return (
		<WorkspaceSettingsGate>
			{(workspace) => <BillingContent workspace={workspace} />}
		</WorkspaceSettingsGate>
	);
}

function BillingContent({ workspace }: { workspace: Workspace }) {
	const isOwner = workspace.my_role === "owner";
	const canManage = isOwner || workspace.my_role === "admin";

	// A plain member cannot read the subscription at all (RLS and the API agree
	// on that), so don't fire a request that would only raise the global 403
	// toast on an otherwise healthy page.
	const summaryQuery = useBillingSummaryQuery(canManage ? workspace.id : null);

	return (
		<div className="app-fade-in">
			<header className="mb-8 flex items-start gap-4">
				<div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary sm:flex">
					<CreditCard className="h-6 w-6" />
				</div>
				<div>
					<h1 className="text-3xl font-semibold tracking-tight text-foreground">
						Billing
					</h1>
					<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
						The plan and seats for this workspace.
					</p>
				</div>
			</header>

			{!canManage ? (
				<section className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-(--app-shadow-sm)">
					<p className="text-sm text-muted-foreground">{MEMBER_ONLY_NOTE}</p>
				</section>
			) : summaryQuery.isLoading ? (
				<div className="flex items-center justify-center py-16">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			) : summaryQuery.data ? (
				<ManagerView
					workspace={workspace}
					summary={summaryQuery.data}
					isOwner={isOwner}
				/>
			) : (
				<section className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-(--app-shadow-sm)">
					<p className="text-sm text-muted-foreground">
						Billing details are unavailable right now. Try again in a moment.
					</p>
				</section>
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

	return (
		<div className="space-y-6">
			<CheckoutReturnBanner />

			{status ? (
				<section
					className={`flex gap-3 rounded-2xl border p-4 ${
						status.tone === "warning"
							? "border-destructive/40 bg-destructive/5 text-destructive"
							: "border-border bg-muted/40 text-muted-foreground"
					}`}
				>
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
					<p className="text-sm">{status.message}</p>
				</section>
			) : null}

			<section className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-(--app-shadow-sm) sm:p-6">
				<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
					Current plan
				</p>
				<p className="mt-2 text-3xl font-semibold text-foreground">
					{PLAN_LABEL[summary.plan]}
					{summary.interval ? (
						<span className="ml-2 text-base font-normal text-muted-foreground">
							billed {summary.interval === "year" ? "yearly" : "monthly"}
						</span>
					) : null}
				</p>

				<div className="mt-6 flex flex-wrap gap-x-8 gap-y-4 border-t border-border pt-5">
					<div>
						<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							Seats
						</p>
						{/* seat_limit is deliberately never rendered: nothing enforces it,
						    and a "6 of 10" reading would describe a rule that does not
						    exist in either direction. */}
						<p className="mt-1 text-xl font-semibold text-foreground">
							{seats.headline}
						</p>
						{seats.note ? (
							<p className="text-xs text-muted-foreground">{seats.note}</p>
						) : null}
					</div>

					<div>
						<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							Invited
						</p>
						<p className="mt-1 text-xl font-semibold text-foreground">
							{pendingInvites}
						</p>
						<p className="text-xs text-muted-foreground">
							{PENDING_INVITES_NOTE}
						</p>
					</div>

					{summary.next_invoice ? (
						<div>
							<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
								Next invoice
							</p>
							<p className="mt-1 text-xl font-semibold text-foreground">
								{formatMoney(
									summary.next_invoice.amount_due_cents,
									summary.next_invoice.currency,
								)}
							</p>
							<p className="text-xs text-muted-foreground">
								{summary.next_invoice.date
									? `Estimated, on ${formatDate(summary.next_invoice.date)}`
									: "Estimated"}
							</p>
						</div>
					) : null}
				</div>

				{summary.payment_method || summary.billing_email ? (
					<div className="mt-5 border-t border-border pt-5 text-sm text-muted-foreground">
						{/* Card digits are an owner's business. An admin sees only that a
						    card exists, because an owner can promote anyone to admin in one
						    request. */}
						{summary.payment_method ? (
							isOwner ? (
								<p>
									{summary.payment_method.brand ?? "Card"} ending{" "}
									{summary.payment_method.last4 ?? "----"}
								</p>
							) : (
								<p>A payment method is on file.</p>
							)
						) : (
							<p>No payment method on file.</p>
						)}
						{summary.billing_email ? (
							<p className="mt-1">Receipts go to {summary.billing_email}.</p>
						) : null}
					</div>
				) : null}
			</section>

			{isOwner ? (
				<OwnerActions workspace={workspace} summary={summary} />
			) : (
				<p className="text-sm text-muted-foreground">{ADMIN_READ_ONLY_NOTE}</p>
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

	return (
		<section className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-(--app-shadow-sm) sm:p-6">
			{summary.portal_available ? (
				<>
					<p className="text-sm text-muted-foreground">
						Change plan, update your payment method, or download invoices.
					</p>
					<button
						type="button"
						className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
						disabled={portal.isPending}
						onClick={() => go(portal.mutateAsync({}))}
					>
						{portal.isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<ExternalLink className="h-4 w-4" />
						)}
						Manage billing
					</button>
				</>
			) : (
				<>
					<p className="text-sm text-muted-foreground">
						Start a subscription for this workspace. You'll be billed for each
						member.
					</p>
					<div className="mt-4 flex flex-wrap gap-2">
						{purchasable.map((plan) =>
							plan.intervals.map((interval) => (
								<button
									key={`${plan.id}-${interval}`}
									type="button"
									className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
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
									{plan.name} ·{" "}
									{interval === "year" ? "billed yearly" : "monthly"}
								</button>
							)),
						)}
					</div>
					{purchasable.length === 0 ? (
						<p className="mt-3 text-xs text-muted-foreground">
							No plans are available for purchase on this environment.
						</p>
					) : null}
				</>
			)}
			{error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
		</section>
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
			<p className="rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
				{CHECKOUT_CANCELLED}
			</p>
		);
	}
	if (search.checkout !== "success") return null;

	return (
		<p className="rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
			{slow ? CHECKOUT_SLOW : CHECKOUT_SETTLING}
		</p>
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
