import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AppSectionHeader, AppSurfaceCard } from "@/components/common/AppPrimitives";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { MemberDisplay } from "@/components/common/MemberDisplay";
import { useToast } from "@/hooks/useToast";
import { useAuthStore, useUser } from "@/stores/authStore";
import { getTeam, listTeamMembers } from "@/services/teams.service";
import {
	teamTimeService,
	type TaskTimeLog,
	type TimeLogReviewDecision,
	type TimeLogStatus,
} from "@/services/team-time.service";

export const Route = createFileRoute("/teams/$teamId/time/log/$logId")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: TeamTimeLogDetailRoute,
});

function formatDuration(seconds: number | null | undefined): string {
	if (!seconds || seconds <= 0) return "—";
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function formatMoney(rate: number, currency: string): string {
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: currency || "USD",
	}).format(rate);
}

function StatusChip({ status }: { status: TimeLogStatus }) {
	const tone =
		status === "approved"
			? "bg-emerald-100 text-emerald-700 border-emerald-200"
			: status === "rejected"
				? "bg-rose-100 text-rose-700 border-rose-200"
				: "bg-amber-100 text-amber-800 border-amber-200";
	return (
		<span
			className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
		>
			{status}
		</span>
	);
}

function FieldRow({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="grid grid-cols-3 gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0">
			<div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
				{label}
			</div>
			<div className="col-span-2 text-sm text-slate-900">{children}</div>
		</div>
	);
}

function TeamTimeLogDetailRoute() {
	const { teamId, logId } = Route.useParams();
	const user = useUser();
	const toast = useToast();
	const qc = useQueryClient();
	const [reason, setReason] = useState("");

	const teamQuery = useQuery({
		queryKey: ["team", teamId],
		queryFn: () => getTeam(teamId),
	});
	const membersQuery = useQuery({
		queryKey: ["team", teamId, "members"],
		queryFn: () => listTeamMembers(teamId),
	});
	const logQuery = useQuery({
		queryKey: ["team-time", "log", logId],
		queryFn: () => teamTimeService.getLog(logId),
	});

	const reviewMutation = useMutation({
		mutationFn: (decision: TimeLogReviewDecision) =>
			teamTimeService.reviewLog(logId, decision, reason || undefined),
		onSuccess: (_, decision) => {
			toast.success(
				decision === "pending"
					? "Reset to pending"
					: decision === "approved"
						? "Approved"
						: "Rejected",
			);
			qc.invalidateQueries({ queryKey: ["team-time", "log", logId] });
			qc.invalidateQueries({ queryKey: ["team-time", teamId] });
			setReason("");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	if (teamQuery.isPending || membersQuery.isPending || logQuery.isPending) {
		return (
			<DashboardShell>
				<div className="flex justify-center p-12">
					<Loader2 className="h-6 w-6 animate-spin text-slate-400" />
				</div>
			</DashboardShell>
		);
	}

	if (logQuery.error) {
		return (
			<DashboardShell>
				<div className="p-6 text-sm text-rose-600">
					{(logQuery.error as Error).message}
				</div>
			</DashboardShell>
		);
	}

	const log = logQuery.data as TaskTimeLog;
	const team = teamQuery.data;
	const myMembership = membersQuery.data?.find((m) => m.user_id === user?.id);
	const isApprover =
		team?.owner_id === user?.id ||
		myMembership?.role === "admin" ||
		myMembership?.role === "owner";
	const isOwn = log.member_user_id === user?.id;
	const canReview = isApprover && !isOwn;
	const seconds = log.duration_seconds ?? 0;
	const amount = (seconds / 3600) * Number(log.rate_snapshot ?? 0);

	return (
		<DashboardShell>
			<div className="space-y-6 p-6">
				<AppSectionHeader
					title="Time log detail"
					subtitle={team?.name ?? undefined}
					rightSlot={
						isApprover ? (
							<Link
								to="/teams/$teamId/time/manage-rates/$userId"
								params={{ teamId, userId: log.member_user_id }}
								className="text-sm text-sky-600 hover:underline"
							>
								Back to {log.member?.display_name ?? "member"}'s logs
							</Link>
						) : (
							<Link
								to="/teams/$teamId/time/my-logs"
								params={{ teamId }}
								className="text-sm text-sky-600 hover:underline"
							>
								Back to my logs
							</Link>
						)
					}
				/>

				<AppSurfaceCard>
					<FieldRow label="Status">
						<StatusChip status={log.status} />
					</FieldRow>
					<FieldRow label="Member">
						{log.member ? (
							<MemberDisplay
								user={{
									id: log.member.id,
									display_name: log.member.display_name ?? null,
									avatar_url: log.member.avatar_url ?? null,
									email: log.member.email ?? null,
									first_name: log.member.first_name ?? null,
									last_name: log.member.last_name ?? null,
								}}
							/>
						) : (
							log.member_user_id
						)}
					</FieldRow>
					<FieldRow label="Project">
						{log.project?.title ?? log.project_id}
					</FieldRow>
					<FieldRow label="Task">{log.task?.title ?? log.task_id}</FieldRow>
					<FieldRow label="Source">{log.source}</FieldRow>
					<FieldRow label="Started">
						{new Date(log.started_at).toLocaleString()}
					</FieldRow>
					<FieldRow label="Ended">
						{log.ended_at ? new Date(log.ended_at).toLocaleString() : "Running"}
					</FieldRow>
					<FieldRow label="Duration">{formatDuration(seconds)}</FieldRow>
					<FieldRow label="Rate">
						{formatMoney(
							Number(log.rate_snapshot ?? 0),
							log.currency_snapshot,
						)}{" "}
						/ hour
					</FieldRow>
					<FieldRow label="Amount">
						<span className="font-semibold">
							{formatMoney(amount, log.currency_snapshot)}
						</span>
					</FieldRow>
					{log.reviewed_at && (
						<>
							<FieldRow label="Reviewed at">
								{new Date(log.reviewed_at).toLocaleString()}
							</FieldRow>
							<FieldRow label="Reviewer">
								{log.reviewer ? (
									<MemberDisplay
										user={{
											id: log.reviewer.id,
											display_name: log.reviewer.display_name ?? null,
											avatar_url: log.reviewer.avatar_url ?? null,
											email: null,
											first_name: null,
											last_name: null,
										}}
									/>
								) : (
									log.reviewed_by ?? "—"
								)}
							</FieldRow>
						</>
					)}
					{log.review_note && (
						<FieldRow label="Review note">{log.review_note}</FieldRow>
					)}
				</AppSurfaceCard>

				{canReview && (
					<AppSurfaceCard>
						<div className="space-y-3 p-4">
							<label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
								Review note (optional)
							</label>
							<textarea
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								rows={3}
								className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
								placeholder="Reason for rejection or note for the member"
							/>
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									disabled={reviewMutation.isPending}
									onClick={() => reviewMutation.mutate("approved")}
									className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
								>
									Approve
								</button>
								<button
									type="button"
									disabled={reviewMutation.isPending}
									onClick={() => reviewMutation.mutate("rejected")}
									className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
								>
									Reject
								</button>
								<button
									type="button"
									disabled={
										reviewMutation.isPending || log.status === "pending"
									}
									onClick={() => reviewMutation.mutate("pending")}
									className="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
								>
									Reset to pending
								</button>
							</div>
						</div>
					</AppSurfaceCard>
				)}
			</div>
		</DashboardShell>
	);
}
