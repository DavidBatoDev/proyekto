import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Paperclip, X } from "lucide-react";
import { commentsService, taskService } from "@/services/roadmap.service";
import type { TaskTimeLog } from "@/services/team-time.service";
import type { TaskStatus } from "@/types/roadmap";
import { initialsFromName } from "./time-utils";

const STATUS_META: Record<TaskStatus, { label: string; cls: string }> = {
	todo: { label: "To do", cls: "bg-slate-100 text-slate-600" },
	in_progress: { label: "In progress", cls: "bg-sky-100 text-sky-700" },
	in_review: { label: "In review", cls: "bg-amber-100 text-amber-800" },
	done: { label: "Done", cls: "bg-emerald-100 text-emerald-700" },
	blocked: { label: "Blocked", cls: "bg-rose-100 text-rose-700" },
};

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
});

/**
 * Read-only peek at a logged task's roadmap details (status, description,
 * comments, attachments) so a reviewer can check progress without leaving the
 * Time section. Opens from a log's "View task details" action.
 */
export function TaskDetailPeek({
	log,
	onClose,
	onOpenInRoadmap,
}: {
	log: TaskTimeLog | null;
	onClose: () => void;
	onOpenInRoadmap?: (log: TaskTimeLog) => void;
}) {
	const taskId = log?.task_id ?? null;

	const taskQuery = useQuery({
		queryKey: ["task-detail", taskId],
		queryFn: () => taskService.getById(taskId as string),
		enabled: Boolean(taskId),
	});
	const commentsQuery = useQuery({
		queryKey: ["task-detail", taskId, "comments"],
		queryFn: () => commentsService.getTaskComments(taskId as string),
		enabled: Boolean(taskId),
	});
	const attachmentsQuery = useQuery({
		queryKey: ["task-detail", taskId, "attachments"],
		queryFn: () => commentsService.getTaskAttachments(taskId as string),
		enabled: Boolean(taskId),
	});

	if (!log) return null;
	const task = taskQuery.data;
	const status = task?.status ? STATUS_META[task.status] : null;
	const comments = commentsQuery.data ?? [];
	const attachments = attachmentsQuery.data ?? [];

	return (
		<div
			className="fixed inset-0 z-[180] flex justify-end bg-slate-900/40"
			onClick={onClose}
		>
			<div
				className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
					<div className="min-w-0">
						<p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
							Task
						</p>
						<h3 className="mt-0.5 truncate text-base font-semibold text-slate-900">
							{task?.title || log.task?.title || "Task"}
						</h3>
						<p className="mt-0.5 truncate text-xs text-slate-500">
							{log.project?.title || ""}
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
						aria-label="Close"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{!taskId ? (
					<div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-slate-500">
						This log isn’t linked to a task.
					</div>
				) : taskQuery.isPending ? (
					<div className="flex flex-1 items-center justify-center">
						<Loader2 className="h-6 w-6 animate-spin text-slate-400" />
					</div>
				) : taskQuery.isError || !task ? (
					<div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-rose-600">
						Couldn’t load this task.
					</div>
				) : (
					<div className="flex-1 space-y-4 p-5">
						{/* Meta */}
						<div className="flex flex-wrap items-center gap-2 text-xs">
							{status && (
								<span
									className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${status.cls}`}
								>
									{status.label}
								</span>
							)}
							{task.priority && (
								<span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 font-medium capitalize text-slate-600">
									{task.priority}
								</span>
							)}
							{task.due_date && (
								<span className="text-slate-500">
									Due {DATE_FMT.format(new Date(task.due_date))}
								</span>
							)}
						</div>

						{/* Description */}
						<div>
							<p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
								Description
							</p>
							{task.description?.trim() ? (
								<div
									className="prose prose-sm max-w-none text-sm text-slate-700"
									// Task descriptions are stored as sanitized rich HTML.
									// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted rich-text field
									dangerouslySetInnerHTML={{ __html: task.description }}
								/>
							) : (
								<p className="text-sm italic text-slate-400">No description.</p>
							)}
						</div>

						{/* Attachments */}
						<div>
							<p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
								Attachments ({attachments.length})
							</p>
							{attachmentsQuery.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin text-slate-400" />
							) : attachments.length === 0 ? (
								<p className="text-sm italic text-slate-400">None.</p>
							) : (
								<ul className="space-y-1">
									{attachments.map((a) => (
										<li key={a.id}>
											<a
												href={a.file_url ?? undefined}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex items-center gap-1.5 text-sm text-sky-600 hover:underline"
											>
												<Paperclip className="h-3.5 w-3.5" />
												<span className="truncate">{a.file_name}</span>
											</a>
										</li>
									))}
								</ul>
							)}
						</div>

						{/* Comments */}
						<div>
							<p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
								Comments ({comments.length})
							</p>
							{commentsQuery.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin text-slate-400" />
							) : comments.length === 0 ? (
								<p className="text-sm italic text-slate-400">No comments yet.</p>
							) : (
								<ul className="space-y-3">
									{comments.map((c) => {
										const name =
											c.user?.display_name ||
											[c.user?.first_name, c.user?.last_name]
												.filter(Boolean)
												.join(" ")
												.trim() ||
											c.user?.email ||
											"Member";
										return (
											<li key={c.id} className="flex gap-2.5">
												{c.user?.avatar_url ? (
													<img
														src={c.user.avatar_url}
														alt={name}
														className="h-7 w-7 shrink-0 rounded-full object-cover"
													/>
												) : (
													<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600">
														{initialsFromName(name)}
													</div>
												)}
												<div className="min-w-0 flex-1">
													<div className="flex items-baseline gap-2">
														<span className="text-xs font-semibold text-slate-800">
															{name}
														</span>
														<span className="text-[10px] text-slate-400">
															{DATE_FMT.format(new Date(c.created_at))}
														</span>
													</div>
													<div
														className="prose prose-sm mt-0.5 max-w-none text-sm text-slate-600"
														// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted rich-text field
														dangerouslySetInnerHTML={{ __html: c.content }}
													/>
												</div>
											</li>
										);
									})}
								</ul>
							)}
						</div>
					</div>
				)}

				{onOpenInRoadmap && log.task_id && (
					<div className="border-t border-slate-200 px-5 py-3">
						<button
							type="button"
							onClick={() => onOpenInRoadmap(log)}
							className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
						>
							<ExternalLink className="h-3.5 w-3.5" />
							Open in roadmap
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
