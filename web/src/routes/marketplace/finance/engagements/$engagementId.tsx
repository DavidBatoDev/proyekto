import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	CalendarClock,
	FileSignature,
	FolderKanban,
	Handshake,
	Loader2,
	Timer,
	Users,
} from "lucide-react";
import type { ReactNode } from "react";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import {
	describeRate,
	describeRelationship,
	describeTimePolicy,
} from "@/components/finance/portfolio/engagementCopy";
import { FinanceStatusBadge } from "@/components/finance/portfolio/FinancePrimitives";
import { MarketplaceShell } from "@/components/layout/MarketplaceShell";
import type {
	Engagement,
	EngagementProjectLink,
} from "@/services/engagement.service";
import { engagementService } from "@/services/engagement.service";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute(
	"/marketplace/finance/engagements/$engagementId",
)({
	beforeLoad: () => {
		if (!useAuthStore.getState().isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: EngagementDetailPage,
});

/**
 * The engagement detail page.
 *
 * `GET /api/engagements/:id` shipped with the read APIs and had no caller: the
 * list linked to the activating *contract* instead, so the signed rates, the
 * time policy and the project links an engagement carries were unreachable from
 * the UI. Authorization is party membership, and a non-party gets a 404 rather
 * than a 403 so ids cannot be probed — which is why the not-found copy below
 * does not distinguish "missing" from "not yours".
 */
function EngagementDetailPage() {
	const { engagementId } = Route.useParams();
	const navigate = useNavigate();
	const query = useQuery({
		queryKey: ["engagement", engagementId],
		queryFn: () => engagementService.byId(engagementId),
		// A miss here is a 404 by design — the API returns not-found rather than
		// forbidden so ids cannot be probed — so it will never succeed on retry,
		// and the default three attempts just held a spinner for ten seconds.
		retry: false,
	});

	const back = () =>
		void navigate({
			to: "/marketplace/finance",
			search: { tab: "engagements" },
		});

	if (query.isPending) {
		return (
			<MarketplaceShell>
				<div className="flex justify-center py-24">
					<Loader2 className="h-6 w-6 animate-spin text-primary" />
				</div>
			</MarketplaceShell>
		);
	}

	if (query.isError || !query.data) {
		return (
			<MarketplaceShell>
				<div className="mx-auto max-w-3xl px-5 py-10">
					<BackLink onClick={back} />
					<AppEmptyState
						icon={Handshake}
						title="Engagement not available"
						description={
							query.error?.message ??
							"This engagement does not exist, or you do not hold a seat on it."
						}
					/>
				</div>
			</MarketplaceShell>
		);
	}

	const engagement = query.data;
	const isClientSide = engagement.kind === "client_services";

	return (
		<MarketplaceShell>
			<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
				<div className="mx-auto w-full max-w-5xl space-y-5 pb-10">
					<BackLink onClick={back} />

					<header className="flex flex-wrap items-start justify-between gap-4">
						<div className="flex min-w-0 items-center gap-3">
							<span
								className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${isClientSide ? "bg-primary/10 text-primary" : "bg-info/10 text-info-foreground"}`}
							>
								<Handshake className="h-5 w-5" />
							</span>
							<div className="min-w-0">
								<h1 className="truncate text-xl font-bold tracking-tight text-foreground">
									{describeRelationship(engagement)}
								</h1>
								<p className="mt-0.5 text-sm text-muted-foreground">
									{isClientSide ? "Client engagement" : "Talent engagement"} ·{" "}
									{engagement.scope_mode === "flexible"
										? "Flexible scope"
										: "Project-specific"}
								</p>
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<FinanceStatusBadge status={engagement.status} />
							{engagement.activated_by_contract_id && (
								<button
									type="button"
									onClick={() =>
										void navigate({
											to: "/marketplace/finance/$contractId",
											params: {
												contractId:
													engagement.activated_by_contract_id as string,
											},
											search: { section: undefined },
										})
									}
									className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
								>
									<FileSignature className="h-3.5 w-3.5" /> Signed contract
								</button>
							)}
						</div>
					</header>

					{engagement.status_reason && (
						<p className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
							{engagement.status_reason}
						</p>
					)}

					<div className="grid gap-4 lg:grid-cols-2">
						<Panel icon={Users} title="Parties">
							<PartyRow
								label={
									engagement.viewer_position === "hirer" ? "Hirer" : "Provider"
								}
								name="You"
								capacity={engagement.viewer_capacity}
							/>
							<PartyRow
								label={
									engagement.viewer_position === "hirer" ? "Provider" : "Hirer"
								}
								name={
									engagement.counterparty?.display_name_snapshot ??
									engagement.counterparty?.email_snapshot ??
									"Counterparty removed"
								}
								capacity={engagement.counterparty?.capacity ?? "—"}
								email={engagement.counterparty?.email_snapshot ?? undefined}
							/>
						</Panel>

						<Panel icon={CalendarClock} title="Timeline">
							<DetailRow
								label="Started"
								value={formatDate(engagement.started_at)}
							/>
							{engagement.ended_at && (
								<DetailRow
									label="Ended"
									value={formatDate(engagement.ended_at)}
								/>
							)}
							{engagement.cancelled_at && (
								<DetailRow
									label="Cancelled"
									value={formatDate(engagement.cancelled_at)}
								/>
							)}
							<DetailRow
								label="Origin"
								value={
									engagement.origin === "legacy"
										? "Migrated from a pre-engagement agreement"
										: "Opened by a signed contract"
								}
							/>
						</Panel>

						<Panel icon={FolderKanban} title="Projects covered">
							{engagement.project_links.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									Flexible engagement — no project placed against it yet.
								</p>
							) : (
								<ul className="space-y-2">
									{engagement.project_links.map((link) => (
										<ProjectLinkRow key={link.id} link={link} />
									))}
								</ul>
							)}
						</Panel>

						<Panel icon={Timer} title="Signed terms">
							{engagement.current_rates.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									No rate is in effect today.
								</p>
							) : (
								<ul className="mb-3 space-y-1.5">
									{engagement.current_rates.map((rate) => (
										<li
											key={rate.id}
											className="flex items-baseline justify-between gap-3 text-sm"
										>
											<span className="text-muted-foreground">
												{rate.rate_kind === "billing"
													? "Billing rate"
													: "Cost rate"}
												{rate.work_type ? ` · ${rate.work_type}` : ""}
											</span>
											<span className="font-semibold text-foreground tabular-nums">
												{describeRate(rate)}
											</span>
										</li>
									))}
								</ul>
							)}
							{engagement.current_settings && (
								<div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
									{describeTimePolicy(engagement.current_settings).map(
										(line) => (
											<span
												key={line}
												className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
											>
												{line}
											</span>
										),
									)}
								</div>
							)}
						</Panel>
					</div>

					<ExecutionNotice engagement={engagement} />
				</div>
			</div>
		</MarketplaceShell>
	);
}

/**
 * An engagement is a commercial fact, not an authorization grant — signing one
 * places nobody on a project. Saying so on the page it belongs to is cheaper
 * than fielding the question every time somebody expects the two to be linked.
 */
function ExecutionNotice({ engagement }: { engagement: Engagement }) {
	return (
		<p className="rounded-xl border border-dashed border-border px-4 py-3 text-xs leading-5 text-muted-foreground">
			This engagement records what was agreed and what it is worth. It grants no
			access to any project workspace
			{engagement.kind === "talent_services"
				? " and does not place this person on your team"
				: ""}
			— project access is granted separately, through the project's people.
		</p>
	);
}

function BackLink({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
		>
			<ArrowLeft className="h-4 w-4" /> All engagements
		</button>
	);
}

function Panel({
	icon: Icon,
	title,
	children,
}: {
	icon: typeof Users;
	title: string;
	children: ReactNode;
}) {
	return (
		<AppSurfaceCard className="p-5">
			<h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
				<Icon className="h-4 w-4 text-muted-foreground" />
				{title}
			</h2>
			{children}
		</AppSurfaceCard>
	);
}

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-3 py-1 text-sm">
			<span className="text-muted-foreground">{label}</span>
			<span className="text-right font-medium text-foreground">{value}</span>
		</div>
	);
}

function PartyRow({
	label,
	name,
	capacity,
	email,
}: {
	label: string;
	name: string;
	capacity: string;
	email?: string;
}) {
	return (
		<div className="flex items-start justify-between gap-3 border-b border-border py-2 last:border-0">
			<div className="min-w-0">
				<p className="truncate text-sm font-medium text-foreground">{name}</p>
				{email && (
					<p className="truncate text-xs text-muted-foreground">{email}</p>
				)}
			</div>
			<div className="shrink-0 text-right">
				<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{label}
				</p>
				<p className="text-xs capitalize text-muted-foreground">{capacity}</p>
			</div>
		</div>
	);
}

function ProjectLinkRow({ link }: { link: EngagementProjectLink }) {
	const ended = link.status === "ended";
	return (
		<li className="flex items-center justify-between gap-3 text-sm">
			<span
				className={`min-w-0 truncate ${ended ? "text-muted-foreground line-through" : "text-foreground"}`}
			>
				{link.project_title_snapshot}
			</span>
			<span className="shrink-0 text-xs text-muted-foreground">
				{link.basis === "contract_scope" ? "Contract scope" : "Placed"}
			</span>
		</li>
	);
}

function formatDate(value: string | null): string {
	if (!value) return "—";
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return "—";
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(parsed);
}
