import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Clock,
	Eye,
	Loader2,
	RotateCcw,
	ShieldCheck,
	SlidersHorizontal,
	Users,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { RateBudgetCalculator } from "@/components/team-time/RateBudgetCalculator";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import { useProjectMyPermissionsQuery } from "@/hooks/useProjectQueries";
import { useToast } from "@/hooks/useToast";
import { isNativeApp } from "@/lib/platform";
import { timeErrorMessage } from "@/lib/timeErrors";
import { sheetScopeLabel } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import { invalidateTime, timeQueries } from "@/queries/time";
import {
	getTeam,
	listCuratedMembers,
	listMemberRates,
	listProjectTeams,
	listTeamMembers,
	type TeamMember,
	type TeamMemberRate,
	updateMemberRate,
} from "@/services/teams.service";
import { isTimeApiError } from "@/services/time.service";
import { useUser } from "@/stores/authStore";
import {
	CLIENT_LEVEL_COPY,
	PROJECT_TIME_SETTINGS_COPY as COPY,
	clientAgreementRows,
	isMaskedLogger,
	loggerLine,
} from "./projectTimeModel";
import { useProjectClientAgreements } from "./useProjectClientAgreements";

/**
 * Project settings › Time (ux.md › Settings › Project Surfaces).
 *
 * - **Who can log time here** (A11): everyone holding `time.log`, each with
 *   where their time goes by default ("Maria (Prodigitality Services Inc.
 *   Team)", "You (editor · just you)"). Placed talent is listed only for
 *   provider-side viewers (the server leaves the rest out or masks them).
 *   It ends "Viewers and commenters can't log time."
 * - **Client sees**: each client agreement's `client_hours_detail_level`,
 *   read-only ("View terms →" on the web only).
 * - The rate and budget calculator (web only) and the per-member **hour
 *   limits**, whose switch now reads "Block time past a limit (otherwise
 *   people just get a warning)"; `HOUR_CAP_EXCEEDED` fires only when it is on.
 *
 * Gated on `time.view_team_logs`, the same grant the settings tab shows on.
 */
export function ProjectTimeSettings({ projectId }: { projectId: string }) {
	const permissionsQuery = useProjectMyPermissionsQuery(projectId);
	const canManageTeamTime = permissionsQuery.data?.time.view_team_logs === true;

	return (
		<section className="space-y-6">
			<div className="flex items-center gap-2">
				<Clock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
				<h2 className="text-2xl font-semibold leading-none text-foreground sm:text-[30px]">
					{COPY.title}
				</h2>
			</div>

			{permissionsQuery.isPending ? (
				<div className="flex justify-center p-12">
					<Loader2
						className="h-6 w-6 animate-spin text-muted-foreground"
						aria-label="Loading"
					/>
				</div>
			) : !canManageTeamTime ? (
				<TimeReasonCard
					variant="inline"
					tone="warning"
					icon={ShieldCheck}
					title={COPY.noAccessTitle}
				>
					{COPY.noAccessDetail}
				</TimeReasonCard>
			) : (
				<>
					<WhoCanLogSection projectId={projectId} />
					<ClientSeesSection projectId={projectId} />
					<HourLimitsSection projectId={projectId} />
				</>
			)}
		</section>
	);
}

function Card({
	id,
	icon: Icon,
	title,
	intro,
	children,
}: {
	id?: string;
	icon: typeof Users;
	title: string;
	intro?: ReactNode;
	children: ReactNode;
}) {
	const headingId = useId();
	return (
		<section
			id={id}
			aria-labelledby={headingId}
			className="app-surface-card-strong scroll-mt-24 overflow-hidden rounded-2xl"
		>
			<div className="space-y-4 px-4 py-5 sm:px-5 sm:py-6">
				<div className="flex items-center gap-2">
					<Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
					<h3 id={headingId} className="text-lg font-semibold text-foreground">
						{title}
					</h3>
				</div>
				{intro ? (
					<p className="max-w-2xl text-sm text-muted-foreground">{intro}</p>
				) : null}
				{children}
			</div>
		</section>
	);
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
	return (
		<button
			type="button"
			onClick={onRetry}
			className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
		>
			<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
			{COPY.retry}
		</button>
	);
}

function ListSkeleton() {
	return (
		<div className="space-y-2" aria-busy="true">
			{[0, 1, 2].map((i) => (
				<div key={i} className="h-9 animate-pulse rounded-lg bg-muted/60" />
			))}
		</div>
	);
}

// ── Who can log time here (A11) ─────────────────────────────────────────────

export function WhoCanLogSection({ projectId }: { projectId: string }) {
	const user = useUser();
	const loggersQuery = useQuery(timeQueries.loggers(projectId));

	// Project admins and owners only: anyone else gets a 404 and the section
	// simply isn't theirs to see (someone granted "see everyone's time"
	// without being an admin).
	if (
		loggersQuery.isError &&
		isTimeApiError(loggersQuery.error) &&
		loggersQuery.error.status === 404
	) {
		return null;
	}

	let body: ReactNode;
	if (loggersQuery.isPending) {
		body = <ListSkeleton />;
	} else if (loggersQuery.isError) {
		body = (
			<TimeReasonCard
				variant="inline"
				tone="danger"
				role="alert"
				title={timeErrorMessage(loggersQuery.error, { operation: "read" })}
				action={<RetryButton onRetry={() => void loggersQuery.refetch()} />}
			/>
		);
	} else {
		const people = loggersQuery.data.people;
		body =
			people.length === 0 ? (
				<p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
					{COPY.whoCanLogEmpty}
				</p>
			) : (
				<ul className="divide-y divide-border rounded-xl border border-border">
					{people.map((person) => {
						const line = loggerLine(person, { selfId: user?.id });
						const masked = isMaskedLogger(person);
						return (
							<li
								key={person.user_id}
								className="flex flex-wrap items-baseline gap-x-1.5 px-3 py-2.5 text-sm"
								data-masked-person={masked ? "" : undefined}
							>
								<span
									className={cn(
										"font-medium",
										masked ? "text-muted-foreground" : "text-foreground",
									)}
								>
									{line.name}
								</span>
								<span className="min-w-0 text-muted-foreground">
									({line.detail})
								</span>
							</li>
						);
					})}
				</ul>
			);
	}

	return (
		<Card
			id="who-can-log"
			icon={Users}
			title={COPY.whoCanLog}
			intro={COPY.whoCanLogIntro}
		>
			{body}
			{loggersQuery.data?.truncated ? (
				<p className="text-xs text-muted-foreground">
					{COPY.whoCanLogTruncated}
				</p>
			) : null}
			<p className="text-xs text-muted-foreground">{COPY.whoCanLogFooter}</p>
		</Card>
	);
}

// ── Client sees ─────────────────────────────────────────────────────────────

export function ClientSeesSection({ projectId }: { projectId: string }) {
	const native = isNativeApp();
	const agreementsQuery = useProjectClientAgreements(projectId);
	const rows = clientAgreementRows(agreementsQuery.data, projectId);

	let body: ReactNode;
	if (agreementsQuery.isPending) {
		body = <ListSkeleton />;
	} else if (agreementsQuery.isError) {
		body = (
			<TimeReasonCard
				variant="inline"
				tone="danger"
				role="alert"
				title={COPY.clientLoadError}
				action={<RetryButton onRetry={() => void agreementsQuery.refetch()} />}
			/>
		);
	} else if (rows.length === 0) {
		body = (
			<p className="text-sm text-muted-foreground">{COPY.clientSeesNone}</p>
		);
	} else {
		body = (
			<>
				<ul className="divide-y divide-border rounded-xl border border-border">
					{rows.map((row) => (
						<li
							key={row.engagementId}
							className="flex flex-col gap-1 px-3 py-2.5 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
						>
							<span className="min-w-0 truncate font-medium text-foreground">
								{sheetScopeLabel("engagement", row.label, { native })}
							</span>
							<span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
								<span className="text-muted-foreground">
									<span className="sr-only">{COPY.clientSees}: </span>
									{CLIENT_LEVEL_COPY[row.level]}
								</span>
								{native ? null : (
									<Link
										to="/engagements/$engagementId"
										params={{ engagementId: row.engagementId }}
										className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
										aria-label={`${COPY.viewTerms}: ${row.label}`}
									>
										{COPY.viewTerms}
										<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
									</Link>
								)}
							</span>
						</li>
					))}
				</ul>
				<p className="text-xs text-muted-foreground">{COPY.clientSeesTerms}</p>
			</>
		);
	}

	return (
		<Card icon={Eye} title={COPY.clientSees} intro={COPY.clientSeesIntro}>
			{body}
		</Card>
	);
}

// ── Hour limits ─────────────────────────────────────────────────────────────

function memberLabel(m: TeamMember): string {
	const composed = [m.user?.first_name, m.user?.last_name]
		.filter(Boolean)
		.join(" ")
		.trim();
	return m.user?.display_name || composed || m.user?.email || m.user_id;
}

export function HourLimitsSection({ projectId }: { projectId: string }) {
	const native = isNativeApp();
	const teamsQuery = useQuery({
		queryKey: ["project", projectId, "teams"],
		queryFn: () => listProjectTeams(projectId),
	});
	const teams = teamsQuery.data ?? [];

	// Full roster of every attached team (for member details: position, avatar).
	const memberQueries = useQueries({
		queries: teams.map((t) => ({
			queryKey: ["team", t.team_id, "members"] as const,
			queryFn: () => listTeamMembers(t.team_id),
		})),
	});
	// The members actually ADDED to this project (curated participants): the
	// limits and the calculator scope to these, not the whole roster.
	const curatedQueries = useQueries({
		queries: teams.map((t) => ({
			queryKey: ["project", projectId, "teams", t.team_id, "curated"] as const,
			queryFn: () => listCuratedMembers(projectId, t.team_id),
		})),
	});
	// Whether each attached team prices its hours. Hour limits stay available
	// regardless; only the calculator is money and disappears for an
	// hours-only team.
	const teamDetailQueries = useQueries({
		queries: teams.map((t) => ({
			queryKey: ["team", t.team_id] as const,
			queryFn: () => getTeam(t.team_id),
		})),
	});
	const ratedTeamIds = new Set(
		teams
			.filter((_, i) => teamDetailQueries[i]?.data?.member_rates_enabled)
			.map((t) => t.team_id),
	);

	const rows = teams.flatMap((t, i) => {
		const curatedIds = new Set(
			(curatedQueries[i]?.data ?? []).map((m) => m.user_id),
		);
		return (memberQueries[i]?.data ?? [])
			.filter((member) => curatedIds.has(member.user_id))
			.map((member) => ({ teamId: t.team_id, member }));
	});
	const ratedRows = rows.filter((r) => ratedTeamIds.has(r.teamId));
	const membersLoading =
		memberQueries.some((q) => q.isPending) ||
		curatedQueries.some((q) => q.isPending);

	let body: ReactNode;
	if (teamsQuery.isPending || membersLoading) {
		body = (
			<div className="flex justify-center p-8">
				<Loader2
					className="h-5 w-5 animate-spin text-muted-foreground"
					aria-label="Loading"
				/>
			</div>
		);
	} else if (teams.length === 0) {
		body = (
			<p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
				{COPY.noTeam}
			</p>
		);
	} else if (rows.length === 0) {
		body = (
			<p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
				{COPY.noMembers}
			</p>
		);
	} else {
		body = (
			<ul className="divide-y divide-border rounded-xl border border-border">
				{rows.map((row) => (
					<LimitRow
						key={`${row.teamId}:${row.member.user_id}`}
						projectId={projectId}
						teamId={row.teamId}
						member={row.member}
					/>
				))}
			</ul>
		);
	}

	return (
		<div className="space-y-6">
			{/* The calculator is contract economics (client rate, recurring fee,
			    budget split), all set up on the web marketplace; the app has no
			    way to act on it. */}
			{ratedRows.length > 0 && !native ? (
				<RateBudgetCalculator projectId={projectId} rows={ratedRows} />
			) : null}
			<Card
				icon={SlidersHorizontal}
				title={COPY.hourLimits}
				intro={COPY.hourLimitsIntro}
			>
				{body}
			</Card>
		</div>
	);
}

function LimitRow({
	projectId,
	teamId,
	member,
}: {
	projectId: string;
	teamId: string;
	member: TeamMember;
}) {
	const toast = useToast();
	const qc = useQueryClient();
	const native = isNativeApp();
	const name = memberLabel(member);

	const ratesKey = [
		"team",
		teamId,
		"rates",
		"history",
		member.user_id,
		projectId,
	] as const;
	const ratesQuery = useQuery({
		queryKey: ratesKey,
		queryFn: () => listMemberRates(teamId, member.user_id, projectId),
	});
	const activeRate: TeamMemberRate | undefined = (ratesQuery.data ?? []).find(
		(r) => r.end_date === null,
	);

	return (
		<li className="px-3 py-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2.5">
					{member.user?.avatar_url ? (
						<img
							src={member.user.avatar_url}
							alt=""
							className="h-8 w-8 shrink-0 rounded-full object-cover"
						/>
					) : (
						<div
							aria-hidden="true"
							className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold uppercase text-muted-foreground"
						>
							{name.trim().charAt(0) || "?"}
						</div>
					)}
					<div className="min-w-0">
						<div className="truncate text-sm font-medium text-foreground">
							{name}
						</div>
						{member.position ? (
							<div className="truncate text-[11px] text-muted-foreground">
								{member.position}
							</div>
						) : null}
					</div>
				</div>

				{ratesQuery.isPending ? (
					<Loader2
						className="h-4 w-4 animate-spin text-muted-foreground"
						aria-label="Loading"
					/>
				) : activeRate ? (
					<LimitEditor
						rate={activeRate}
						memberName={name}
						teamId={teamId}
						userId={member.user_id}
						onSaved={() => {
							toast.success(COPY.saved);
							void qc.invalidateQueries({ queryKey: ratesKey });
							// Member caps feed the team context's resolved policy
							// (the Submit sheet's over-the-limit checks).
							void invalidateTime(qc, "policy");
						}}
						onError={(message) => toast.error(message)}
					/>
				) : (
					<span className="text-xs italic text-muted-foreground">
						{native ? COPY.noLimitRecordNative : COPY.noLimitRecordWeb}
					</span>
				)}
			</div>
		</li>
	);
}

function hoursText(value: number | null): string {
	return value == null ? "" : String(value);
}

export function LimitEditor({
	rate,
	memberName,
	teamId,
	userId,
	onSaved,
	onError,
}: {
	rate: Pick<
		TeamMemberRate,
		| "id"
		| "weekly_limit_hours"
		| "monthly_limit_hours"
		| "overtime_requires_approval"
	>;
	memberName: string;
	teamId: string;
	userId: string;
	onSaved: () => void;
	onError: (message: string) => void;
}) {
	const [weekly, setWeekly] = useState(hoursText(rate.weekly_limit_hours));
	const [monthly, setMonthly] = useState(hoursText(rate.monthly_limit_hours));
	const [block, setBlock] = useState(Boolean(rate.overtime_requires_approval));
	const blockId = useId();

	const dirty =
		weekly !== hoursText(rate.weekly_limit_hours) ||
		monthly !== hoursText(rate.monthly_limit_hours) ||
		block !== Boolean(rate.overtime_requires_approval);

	const mutation = useMutation({
		mutationFn: () =>
			updateMemberRate(teamId, userId, rate.id, {
				weekly_limit_hours: weekly === "" ? null : Number(weekly),
				monthly_limit_hours: monthly === "" ? null : Number(monthly),
				overtime_requires_approval: block,
			}),
		onSuccess: onSaved,
		onError: (e: Error) => onError(e.message),
	});

	const inputClass =
		"w-16 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

	return (
		<div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 sm:w-auto">
			<label className="flex items-center gap-1 text-[11px] text-muted-foreground">
				{COPY.weekly}
				<input
					type="number"
					min={0}
					step="0.5"
					inputMode="decimal"
					value={weekly}
					onChange={(e) => setWeekly(e.target.value)}
					placeholder="—"
					aria-label={`${COPY.weekly} ${COPY.hoursSuffix}: ${memberName}`}
					className={inputClass}
				/>
			</label>
			<label className="flex items-center gap-1 text-[11px] text-muted-foreground">
				{COPY.monthly}
				<input
					type="number"
					min={0}
					step="0.5"
					inputMode="decimal"
					value={monthly}
					onChange={(e) => setMonthly(e.target.value)}
					placeholder="—"
					aria-label={`${COPY.monthly} ${COPY.hoursSuffix}: ${memberName}`}
					className={inputClass}
				/>
			</label>
			<label
				htmlFor={blockId}
				className="flex max-w-xs items-start gap-1.5 text-[11px] leading-snug text-muted-foreground"
			>
				<input
					id={blockId}
					type="checkbox"
					checked={block}
					onChange={(e) => setBlock(e.target.checked)}
					className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
				/>
				<span>{COPY.blockLabel}</span>
			</label>
			<button
				type="button"
				onClick={() => mutation.mutate()}
				disabled={!dirty || mutation.isPending}
				aria-label={`${COPY.save}: ${memberName}`}
				className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
			>
				{mutation.isPending ? COPY.saving : COPY.save}
			</button>
		</div>
	);
}
