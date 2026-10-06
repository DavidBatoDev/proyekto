import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	featureLimitInfo,
	PlanLimitNotice,
} from "@/components/billing/PlanLimitNotice";
import { PayPeriodSettingsCard } from "@/components/team-time/PayPeriodSettingsCard";
import { SettingSwitch } from "@/components/team-time/SettingSwitch";
import {
	SettingsSection,
	settingsButton,
} from "@/components/workspace/settings/SettingsPrimitives";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useToast } from "@/hooks/useToast";
import { isPlanLimitError } from "@/lib/planLimitErrors";
import { isNativeApp } from "@/lib/platform";
import { timePlanCopy } from "@/lib/timeErrors";
import { cn } from "@/lib/utils";
import { invalidateTime } from "@/queries/time";
import {
	type Team,
	type UpdateTeamPatch,
	updateTeam,
} from "@/services/teams.service";
import type { TeamTimeWorkspace } from "./TeamRulesSection";

/**
 * Team settings › Time › Money (ux.md › Team Override): member rates, payouts
 * nested under them, the billing and pay cut-offs (L14) and the default
 * currency. Web only: every row here names a rate, a payout or billing, which
 * the installed app never shows, so this renders nothing on native.
 *
 * - Every switch is the team owner's (`TEAM_OWNER_ONLY_UPDATE_FIELDS`); team
 *   admins see the values read-only.
 * - Payouts need `time_payouts` (Business) to turn on; a team that already
 *   pays can still turn them off on a smaller plan.
 * - The cut-off editor opens with `time_billable_invoices` or `time_payouts`
 *   (D39); otherwise it is read-only behind the cut-off plan notice.
 */

export const TEAM_MONEY_COPY = {
	title: "Money",
	rates: "Member rates",
	ratesOn:
		"Hours carry an internal cost: each member has a rate card, and logged time accrues a value you can report on.",
	ratesOff:
		"This team tracks hours only. Turn this on to give members rate cards so their logged time carries a cost.",
	ratesOffNote:
		"While this is off, the Manage Rates tab is hidden and new time records no fee. Existing rate cards and past amounts are kept, and reappear unchanged if you turn it back on.",
	manageRates: "Manage rates",
	payouts: "Payouts",
	payoutsNested: "(under member rates)",
	payoutsNeedRates:
		"Needs member rates — a payout is priced from each member's rate.",
	payoutsOn:
		"Record payments you have made against cut-off periods, and mark the hours they covered as paid.",
	payoutsOff:
		"This team prices its hours but settles pay outside Proyekto. Turn this on to track cut-off periods and record payments here.",
	currency: "Default currency",
	currencyHint:
		"Used as the fallback currency for member rates and new time. Existing time keeps the currency it was recorded in.",
	ownerOnly: "Only the team owner can change these settings.",
	ratesEnabled: "Member rates enabled",
	ratesDisabled: "Member rates disabled — payouts turned off with them",
	payoutsEnabled: "Payouts enabled",
	payoutsDisabled: "Payouts disabled",
	currencySet: (code: string) => `Default currency set to ${code}`,
} as const;

export const TEAM_CURRENCIES = ["USD", "CAD", "PHP"] as const;
export type TeamCurrency = (typeof TEAM_CURRENCIES)[number];

export interface TeamMoneySectionProps {
	team: Pick<
		Team,
		| "id"
		| "member_rates_enabled"
		| "payouts_enabled"
		| "default_currency"
		| "pay_period_config"
	>;
	/** The team owner; everyone else reads. */
	isOwner: boolean;
	/** The team's workspace (its plan decides payouts and the cut-off editor). */
	workspace: TeamTimeWorkspace | null;
	/** The route's workspace slug, for the Manage rates link. */
	workspaceSlug: string;
	className?: string;
}

type MoneyPatch = Pick<
	UpdateTeamPatch,
	"member_rates_enabled" | "payouts_enabled" | "default_currency"
>;

/**
 * The toast for a refused money write. The teams API names raw columns in its
 * owner-only refusal ("Only the team owner can change: payouts_enabled"), so
 * that one reads in people words; every other refusal is already a sentence.
 */
export function moneyErrorMessage(error: Error): string {
	return /^Only the team owner can change:/.test(error.message)
		? TEAM_MONEY_COPY.ownerOnly
		: error.message;
}

export function TeamMoneySection({
	team,
	isOwner,
	workspace,
	workspaceSlug,
	className,
}: TeamMoneySectionProps) {
	const qc = useQueryClient();
	const toast = useToast();
	const native = isNativeApp();
	const entitlements = useEntitlements(native ? null : (workspace?.id ?? null));

	const mutation = useMutation({
		mutationFn: (patch: MoneyPatch) => updateTeam(team.id, patch),
		onSuccess: (updated, patch) => {
			if (patch.member_rates_enabled !== undefined) {
				toast.success(
					updated.member_rates_enabled
						? TEAM_MONEY_COPY.ratesEnabled
						: TEAM_MONEY_COPY.ratesDisabled,
				);
			} else if (patch.payouts_enabled !== undefined) {
				toast.success(
					updated.payouts_enabled
						? TEAM_MONEY_COPY.payoutsEnabled
						: TEAM_MONEY_COPY.payoutsDisabled,
				);
			} else if (patch.default_currency !== undefined) {
				toast.success(
					TEAM_MONEY_COPY.currencySet(updated.default_currency ?? "USD"),
				);
			}
			qc.invalidateQueries({ queryKey: ["teams", "detail", team.id] });
			qc.invalidateQueries({ queryKey: ["team", team.id] });
			qc.invalidateQueries({ queryKey: ["teams", "mine"] });
			// Member rates move the For option's rate source, its approval routing
			// and the forced approval (L23).
			if (patch.member_rates_enabled !== undefined) {
				void invalidateTime(qc, "policy");
			}
		},
		onError: (error: Error) => {
			// The plan prompt is raised globally (api/axios notifyPlanLimit).
			if (isPlanLimitError(error)) return;
			toast.error(moneyErrorMessage(error));
		},
	});

	if (native) return null;

	const pendingField = mutation.isPending
		? Object.keys(mutation.variables ?? {})[0]
		: null;
	const hasRates = team.member_rates_enabled === true;
	const canPay = team.payouts_enabled === true;
	const currency = (team.default_currency ?? "USD") as TeamCurrency;
	const noticeWorkspace = workspace?.slug
		? { slug: workspace.slug, my_role: workspace.my_role ?? null }
		: null;

	const payoutsInfo = featureLimitInfo(entitlements, "time_payouts");
	// D39: either plan feature opens the cut-off editor; unknown usage fails open.
	const cutoffsAllowed =
		entitlements.hasFeature("time_billable_invoices") ||
		entitlements.hasFeature("time_payouts");
	const cutoffsInfo = cutoffsAllowed
		? null
		: featureLimitInfo(entitlements, "time_billable_invoices");
	const cutoffsCopy = timePlanCopy("time_billable_invoices", {
		workspaceName: workspace?.name,
		context: "cutoffs",
		native,
	});

	return (
		<SettingsSection
			id="team-money"
			title={TEAM_MONEY_COPY.title}
			className={className}
		>
			<div className="divide-y divide-border" data-testid="team-money">
				<div className="py-4 first:pt-0 last:pb-0">
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0">
							<div
								id="team-money-rates"
								className="text-sm font-medium leading-5 text-foreground"
							>
								{TEAM_MONEY_COPY.rates}
							</div>
							<p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted-foreground">
								{hasRates ? TEAM_MONEY_COPY.ratesOn : TEAM_MONEY_COPY.ratesOff}
							</p>
						</div>
						<SettingSwitch
							checked={hasRates}
							disabled={!isOwner || mutation.isPending}
							onChange={(next) =>
								mutation.mutate({ member_rates_enabled: next })
							}
							label={TEAM_MONEY_COPY.rates}
						/>
					</div>
					{hasRates ? (
						<Link
							to="/w/$workspaceSlug/teams/$teamId/time/manage-rates"
							params={{ workspaceSlug, teamId: team.id }}
							className={cn(settingsButton.link, "mt-2 text-xs")}
						>
							{TEAM_MONEY_COPY.manageRates}
						</Link>
					) : (
						<p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
							{TEAM_MONEY_COPY.ratesOffNote}
						</p>
					)}

					{/* Payouts are nested because a payout is priced from a rate: with
					    no rates a payout would record a zero-value payment, which the
					    DB refuses outright. */}
					<div className="mt-5 border-l-2 border-border pl-4">
						<div className="flex items-start justify-between gap-4">
							<div className="min-w-0">
								<div className="text-sm font-medium leading-5 text-foreground">
									{TEAM_MONEY_COPY.payouts}{" "}
									<span className="text-xs font-normal text-muted-foreground">
										{TEAM_MONEY_COPY.payoutsNested}
									</span>
								</div>
								<p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted-foreground">
									{!hasRates
										? TEAM_MONEY_COPY.payoutsNeedRates
										: canPay
											? TEAM_MONEY_COPY.payoutsOn
											: TEAM_MONEY_COPY.payoutsOff}
								</p>
							</div>
							<SettingSwitch
								checked={canPay}
								disabled={
									!isOwner ||
									!hasRates ||
									mutation.isPending ||
									// Turning payouts on needs time_payouts; off never does.
									(!canPay && payoutsInfo !== null)
								}
								onChange={(next) => mutation.mutate({ payouts_enabled: next })}
								label={TEAM_MONEY_COPY.payouts}
							/>
						</div>
						{payoutsInfo ? (
							<PlanLimitNotice
								info={payoutsInfo}
								workspace={noticeWorkspace}
								message={timePlanCopy("time_payouts", {
									workspaceName: workspace?.name,
									native,
								})}
								isComplimentary={entitlements.isComplimentary}
								variant="inline"
								className="mt-3"
							/>
						) : null}
					</div>
				</div>

				<div className="py-4 first:pt-0 last:pb-0">
					<PayPeriodSettingsCard
						teamId={team.id}
						config={team.pay_period_config}
						canManage={isOwner}
						planNotice={
							cutoffsInfo ? (
								<PlanLimitNotice
									info={cutoffsInfo}
									workspace={noticeWorkspace}
									message={cutoffsCopy}
									isComplimentary={entitlements.isComplimentary}
									variant="inline"
								/>
							) : null
						}
					/>
				</div>

				<div className="py-4 first:pt-0 last:pb-0">
					<div className="text-sm font-medium leading-5 text-foreground">
						{TEAM_MONEY_COPY.currency}
					</div>
					<p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted-foreground">
						{TEAM_MONEY_COPY.currencyHint}
					</p>
					<div
						role="radiogroup"
						aria-label={TEAM_MONEY_COPY.currency}
						className="mt-3 inline-flex rounded-lg border border-border bg-muted p-1"
					>
						{TEAM_CURRENCIES.map((code) => {
							const active = currency === code;
							return (
								<button
									key={code}
									type="button"
									role="radio"
									aria-checked={active}
									disabled={
										!isOwner || active || pendingField === "default_currency"
									}
									onClick={() => mutation.mutate({ default_currency: code })}
									className={
										active
											? "rounded-md bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm"
											: "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
									}
								>
									{code}
								</button>
							);
						})}
					</div>
				</div>
			</div>

			{!isOwner ? (
				<p
					data-testid="team-money-owner-only"
					className="mt-4 text-xs leading-relaxed text-muted-foreground"
				>
					{TEAM_MONEY_COPY.ownerOnly}
				</p>
			) : null}
		</SettingsSection>
	);
}
