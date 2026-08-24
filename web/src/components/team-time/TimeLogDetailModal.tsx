/**
 * Time log detail — status, snapshot fields, the work & break timeline, and the
 * review thread — as a dialog over whichever log list you came from.
 *
 * This used to be a full page at /teams/$teamId/time/log/$logId. Because that
 * route is nested under the Time layout, which already renders `DashboardShell`,
 * the page rendered a *second* shell inside the first — the duplicated sidebar
 * you could see down the middle of the screen. Reading one row's timeline also
 * cost a full navigation away from the list and back. A dialog fixes both: the
 * list stays put underneath, and there is only ever one shell.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coffee, Loader2, MessageSquarePlus, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { MemberDisplay } from "@/components/common/MemberDisplay";
import { useToast } from "@/hooks/useToast";
import {
	type TaskTimeLog,
	type TimeLogReviewDecision,
	type TimeLogSegment,
	type TimeLogStatus,
	teamTimeService,
} from "@/services/team-time.service";
import { getTeam, listTeamMembers } from "@/services/teams.service";
import { useUser } from "@/stores/authStore";
import { formatMoney } from "./time-utils";

function formatDuration(seconds: number | null | undefined): string {
	if (!seconds || seconds <= 0) return "—";
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function StatusChip({ status }: { status: TimeLogStatus }) {
	const tone =
		status === "approved"
			? "bg-emerald-100 text-emerald-700 border-emerald-200"
			: status === "paid"
				? "bg-indigo-100 text-indigo-700 border-indigo-200"
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
		<div className="grid grid-cols-3 gap-4 border-b border-border px-3 py-2.5 last:border-b-0">
			<div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			<div className="col-span-2 text-sm text-foreground">{children}</div>
		</div>
	);
}

function SegmentRow({ segment }: { segment: TimeLogSegment }) {
	const isBreak = segment.kind === "break";
	const started = new Date(segment.started_at);
	const ended = segment.ended_at ? new Date(segment.ended_at) : null;
	const seconds = ended
		? Math.max(0, Math.floor((ended.getTime() - started.getTime()) / 1000))
		: null;
	return (
		<div
			className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
				isBreak ? "border-amber-200 bg-amber-50" : "border-border bg-card"
			}`}
		>
			{isBreak ? (
				<Coffee className="h-3.5 w-3.5 shrink-0 text-amber-600" />
			) : (
				<Timer className="h-3.5 w-3.5 shrink-0 text-sky-600" />
			)}
			<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				{isBreak ? "Break" : "Work"}
			</span>
			<span className="text-sm text-foreground">
				{started.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
				{" – "}
				{ended
					? ended.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
					: "now"}
			</span>
			<span className="ml-auto text-xs tabular-nums text-muted-foreground">
				{seconds === null ? "running" : formatDuration(seconds)}
			</span>
		</div>
	);
}

function SectionCard({
	icon,
	title,
	children,
}: {
	icon: React.ReactNode;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded-xl border border-border bg-card">
			<div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
				{icon}
				<h3 className="text-sm font-semibold text-card-foreground">{title}</h3>
			</div>
			<div className="p-3">{children}</div>
		</section>
	);
}

export interface TimeLogDetailModalProps {
	teamId: string;
	/** Open when set; the dialog closes when this goes null. */
	logId: string | null;
	onClose: () => void;
}

export function TimeLogDetailModal({
	teamId,
	logId,
	onClose,
}: TimeLogDetailModalProps) {
	const user = useUser();
	const toast = useToast();
	const qc = useQueryClient();
	const [reason, setReason] = useState("");
	const [commentBody, setCommentBody] = useState("");
	const open = Boolean(logId);

	// Drafts belong to the log you opened, not to the dialog — otherwise a note
	// typed for one row follows you into the next one.
	useEffect(() => {
		setReason("");
		setCommentBody("");
	}, [logId]);

	const teamQuery = useQuery({
		queryKey: ["team", teamId],
		queryFn: () => getTeam(teamId),
		enabled: open,
	});
	const membersQuery = useQuery({
		queryKey: ["team", teamId, "members"],
		queryFn: () => listTeamMembers(teamId),
		enabled: open,
	});
	const logQuery = useQuery({
		queryKey: ["team-time", "log", logId],
		queryFn: () => teamTimeService.getLog(logId as string),
		enabled: open,
	});
	const commentsQuery = useQuery({
		queryKey: ["team-time", "log", logId, "comments"],
		queryFn: () => teamTimeService.listLogComments(logId as string),
		enabled: open,
	});
	const segmentsQuery = useQuery({
		queryKey: ["team-time", "log", logId, "segments"],
		queryFn: () => teamTimeService.listLogSegments(logId as string),
		enabled: open,
	});

	const reviewMutation = useMutation({
		mutationFn: (decision: TimeLogReviewDecision) =>
			teamTimeService.reviewLog(logId as string, decision, reason || undefined),
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

	const commentMutation = useMutation({
		mutationFn: () =>
			teamTimeService.createLogComment(logId as string, commentBody.trim()),
		onSuccess: () => {
			toast.success("Comment added");
			setCommentBody("");
			qc.invalidateQueries({
				queryKey: ["team-time", "log", logId, "comments"],
			});
			qc.invalidateQueries({ queryKey: ["team-time", "log", logId] });
			qc.invalidateQueries({ queryKey: ["team-time", teamId] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const busy = reviewMutation.isPending || commentMutation.isPending;
	const log = logQuery.data as TaskTimeLog | undefined;
	const team = teamQuery.data;
	const myMembership = membersQuery.data?.find((m) => m.user_id === user?.id);
	const isApprover =
		team?.owner_id === user?.id ||
		myMembership?.role === "admin" ||
		myMembership?.role === "owner";
	const canReview = Boolean(
		isApprover && log && log.member_user_id !== user?.id,
	);
	const seconds = log?.duration_seconds ?? 0;
	const amount = (seconds / 3600) * Number(log?.rate_snapshot ?? 0);

	return (
		<AppDialog
			open={open}
			onClose={onClose}
			busy={busy}
			size="lg"
			title="Time log detail"
			description={team?.name ?? undefined}
		>
			{logQuery.isPending ? (
				<div className="flex justify-center py-12">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			) : logQuery.error || !log ? (
				<div className="py-6 text-sm text-destructive">
					{(logQuery.error as Error | null)?.message ?? "Log not found."}
				</div>
			) : (
				<div className="space-y-4">
					<div className="rounded-xl border border-border bg-card">
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
						<FieldRow label="Task">
							{log.task?.title ?? log.task_id ?? "—"}
						</FieldRow>
						<FieldRow label="Source">{log.source}</FieldRow>
						<FieldRow label="Started">
							{new Date(log.started_at).toLocaleString()}
						</FieldRow>
						<FieldRow label="Ended">
							{log.ended_at
								? new Date(log.ended_at).toLocaleString()
								: "Running"}
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
										(log.reviewed_by ?? "—")
									)}
								</FieldRow>
							</>
						)}
						{log.review_note && (
							<FieldRow label="Review note">{log.review_note}</FieldRow>
						)}
					</div>

					{log.source === "timer" && (
						<SectionCard
							icon={<Timer className="h-4 w-4 text-muted-foreground" />}
							title="Work & break timeline"
						>
							{segmentsQuery.isPending ? (
								<div className="text-sm text-muted-foreground">
									Loading timeline…
								</div>
							) : (segmentsQuery.data ?? []).length === 0 ? (
								<div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
									No segment history for this log — it predates per-pause
									tracking or its times were edited manually.
								</div>
							) : (
								<div className="space-y-1.5">
									{(segmentsQuery.data ?? []).map((segment) => (
										<SegmentRow key={segment.id} segment={segment} />
									))}
								</div>
							)}
						</SectionCard>
					)}

					{canReview && (
						<SectionCard
							icon={
								<MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
							}
							title="Review"
						>
							<div className="space-y-3">
								<label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
									Review note (optional)
								</label>
								<textarea
									value={reason}
									onChange={(e) => setReason(e.target.value)}
									rows={3}
									className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
									placeholder="Reason for rejection or note for the member"
								/>
								<div className="flex flex-wrap gap-2">
									<button
										type="button"
										disabled={reviewMutation.isPending}
										onClick={() => reviewMutation.mutate("approved")}
										className="rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
									>
										Approve
									</button>
									<button
										type="button"
										disabled={reviewMutation.isPending}
										onClick={() => reviewMutation.mutate("rejected")}
										className="rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
									>
										Reject
									</button>
									<button
										type="button"
										disabled={
											reviewMutation.isPending || log.status === "pending"
										}
										onClick={() => reviewMutation.mutate("pending")}
										className="rounded-lg border border-input px-3.5 py-2 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
									>
										Reset to pending
									</button>
								</div>
							</div>
						</SectionCard>
					)}

					<SectionCard
						icon={
							<MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
						}
						title="Review discussion"
					>
						<div className="space-y-3">
							<div className="space-y-2">
								{commentsQuery.isPending ? (
									<div className="text-sm text-muted-foreground">
										Loading comments…
									</div>
								) : (commentsQuery.data ?? []).length === 0 ? (
									<div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
										No comments yet. Use this thread for disputes or
										clarifications.
									</div>
								) : (
									(commentsQuery.data ?? []).map((comment) => (
										<div
											key={comment.id}
											className="rounded-md border border-border bg-card px-3 py-2"
										>
											<div className="flex items-center justify-between gap-2">
												<div className="text-xs font-semibold text-foreground">
													{comment.author?.display_name ||
														[
															comment.author?.first_name,
															comment.author?.last_name,
														]
															.filter(Boolean)
															.join(" ")
															.trim() ||
														comment.author?.email ||
														comment.author_user_id}
												</div>
												<div className="text-[11px] text-muted-foreground">
													{new Date(comment.created_at).toLocaleString()}
												</div>
											</div>
											<div className="mt-1 whitespace-pre-wrap wrap-break-word text-sm text-foreground">
												{comment.body}
											</div>
										</div>
									))
								)}
							</div>
							<div className="space-y-2">
								<label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
									Add comment
								</label>
								<textarea
									value={commentBody}
									onChange={(event) => setCommentBody(event.target.value)}
									rows={3}
									maxLength={2000}
									placeholder="Add context for approvals, rejections, or disputes."
									className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
								/>
								<div className="flex justify-end">
									<button
										type="button"
										onClick={() => commentMutation.mutate()}
										disabled={commentMutation.isPending || !commentBody.trim()}
										className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
									>
										{commentMutation.isPending && (
											<Loader2 className="h-3.5 w-3.5 animate-spin" />
										)}
										Post comment
									</button>
								</div>
							</div>
						</div>
					</SectionCard>
				</div>
			)}
		</AppDialog>
	);
}
