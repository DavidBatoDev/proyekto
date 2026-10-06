/**
 * "Assign to project" on the engagement page (ux.md › Engagement page).
 *
 * - A talent engagement's hirer assigns the talent; a client engagement's
 *   consultant assigns themselves (the server enforces both).
 * - The projects offered are the engagement's linked projects, plus, for a
 *   flexible engagement, the projects the caller administers (assigning there
 *   places the engagement on the project; the server checks admin).
 * - When more than one client agreement qualifies, the server answers
 *   `ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED` with the candidates, and the
 *   dialog asks "Which client agreement is this work for?" before sending
 *   again with the choice (L8).
 * - `access_needed` on the result goes back to the caller, which says "Ask a
 *   project admin to add Leo." (L25).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { Dropdown } from "@/components/common/Dropdown";
import { FieldLabel } from "@/components/common/FormFields";
import { useToast } from "@/hooks/useToast";
import type { Engagement } from "@/services/engagement.service";
import {
	ASSIGNMENT_ROLE_TITLE_MAX,
	type ClientEngagementChoice,
	type CreatedEngagementAssignment,
	clientEngagementChoices,
	type EngagementAssignment,
	engagementAssignmentsService,
} from "@/services/engagementAssignments.service";
import { useAuthStore } from "@/stores/authStore";
import {
	ASSIGNMENT_COPY,
	assignDialogDescription,
	assignedToast,
	assignmentAuthority,
	assignmentErrorCopy,
	assignmentGrantNote,
	localInputToIso,
	nowLocalInput,
} from "./assignmentCopy";
import {
	type AssignableProject,
	invalidateAfterAssignmentChange,
	isAlreadyAssigned,
	useAssignableProjects,
} from "./useEngagementAssignments";

const INPUT_CLASS =
	"w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70";

export interface AssignToProjectDialogProps {
	engagement: Engagement;
	/** The engagement's assignments, to mark projects the worker is already on. */
	assignments: readonly EngagementAssignment[];
	onClose: () => void;
	/** After a successful create (the dialog has already toasted and refreshed). */
	onAssigned: (result: CreatedEngagementAssignment) => void;
}

/** Labels for the client-agreement question; repeated names get " · 2", " · 3". */
export function clientChoiceLabels(
	choices: readonly ClientEngagementChoice[],
): string[] {
	const seen = new Map<string, number>();
	return choices.map((choice) => {
		const count = (seen.get(choice.label) ?? 0) + 1;
		seen.set(choice.label, count);
		return count === 1 ? choice.label : `${choice.label} · ${count}`;
	});
}

function projectOptionLabel(
	project: AssignableProject,
	assigned: boolean,
): string {
	const notes: string[] = [];
	if (!project.linked) notes.push(ASSIGNMENT_COPY.notOnAgreementSuffix);
	if (assigned) notes.push(ASSIGNMENT_COPY.alreadyAssignedSuffix);
	return notes.length
		? `${project.title} · ${notes.join(" · ")}`
		: project.title;
}

export function AssignToProjectDialog({
	engagement,
	assignments,
	onClose,
	onAssigned,
}: AssignToProjectDialogProps) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const viewerId = useAuthStore((state) => state.user?.id ?? null);
	const authority = assignmentAuthority(engagement);
	const { projects, loading, failed } = useAssignableProjects(engagement);
	const roleId = useId();
	const startId = useId();
	const questionId = useId();

	const assignedIds = useMemo(
		() =>
			new Set(
				projects
					.filter((project) =>
						isAlreadyAssigned(assignments, project.id, {
							self: authority.self,
							viewerId,
						}),
					)
					.map((project) => project.id),
			),
		[projects, assignments, authority.self, viewerId],
	);

	const [projectId, setProjectId] = useState("");
	const [role, setRole] = useState("");
	const [start, setStart] = useState("");
	const [choices, setChoices] = useState<ClientEngagementChoice[] | null>(null);
	const [clientEngagementId, setClientEngagementId] = useState("");
	const [error, setError] = useState<string | null>(null);

	// Preselect the first project the worker isn't on yet, once the whole list
	// is known (a flexible engagement's other projects load after the linked ones).
	useEffect(() => {
		if (projectId || loading || projects.length === 0) return;
		const first =
			projects.find((project) => !assignedIds.has(project.id)) ?? projects[0];
		setProjectId(first.id);
	}, [projectId, loading, projects, assignedIds]);

	const selected = projects.find((project) => project.id === projectId) ?? null;

	const chooseProject = (id: string) => {
		setProjectId(id);
		// The client agreements that qualify depend on the project.
		setChoices(null);
		setClientEngagementId("");
		setError(null);
	};

	const mutation = useMutation({
		mutationFn: () =>
			engagementAssignmentsService.create(engagement.id, {
				project_id: projectId,
				role_title: role,
				started_at: localInputToIso(start),
				client_engagement_id: clientEngagementId || undefined,
			}),
		onSuccess: async (result) => {
			toast.success(
				assignedToast(
					authority.self ? null : (authority.workerName ?? result.worker_label),
					result.project_title_snapshot,
				),
			);
			await invalidateAfterAssignmentChange(
				queryClient,
				engagement.id,
				result.project_id,
			);
			onAssigned(result);
		},
		onError: (err) => {
			const candidates = clientEngagementChoices(err);
			if (candidates && candidates.length > 0) {
				setChoices(candidates);
				setClientEngagementId("");
				setError(null);
				return;
			}
			setError(
				assignmentErrorCopy(err, {
					workerName: authority.workerName,
					operation: "create",
				}),
			);
		},
	});

	const needsChoice = Boolean(choices && choices.length > 0);
	const choiceLabels = choices ? clientChoiceLabels(choices) : [];
	const canSubmit =
		!mutation.isPending &&
		Boolean(selected) &&
		(!needsChoice || Boolean(clientEngagementId));

	const submit = () => {
		if (!canSubmit) return;
		setError(null);
		mutation.mutate();
	};

	const noProjects = !loading && projects.length === 0;

	return (
		<AppDialog
			open
			onClose={onClose}
			busy={mutation.isPending}
			title={ASSIGNMENT_COPY.assignTitle}
			description={assignDialogDescription(authority)}
			footer={
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						disabled={mutation.isPending}
						className="rounded-lg border border-border px-3.5 py-2 text-sm font-semibold text-foreground hover:bg-muted"
					>
						{ASSIGNMENT_COPY.cancel}
					</button>
					<button
						type="button"
						onClick={submit}
						disabled={!canSubmit}
						className="app-cta inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
					>
						{mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
						{mutation.isPending
							? ASSIGNMENT_COPY.assigning
							: ASSIGNMENT_COPY.assignConfirm}
					</button>
				</div>
			}
		>
			{loading && projects.length === 0 ? (
				<div className="flex justify-center py-8">
					<Loader2
						className="h-5 w-5 animate-spin text-primary"
						aria-label={ASSIGNMENT_COPY.loadingLabel}
					/>
				</div>
			) : noProjects ? (
				<p
					role={failed ? "alert" : undefined}
					className={`text-sm ${failed ? "text-destructive" : "text-muted-foreground"}`}
				>
					{failed
						? ASSIGNMENT_COPY.projectsLoadFailed
						: engagement.scope_mode === "flexible"
							? ASSIGNMENT_COPY.noProjectToChoose
							: ASSIGNMENT_COPY.noLinkedProject}
				</p>
			) : (
				<div className="space-y-4">
					<FieldLabel label={ASSIGNMENT_COPY.projectLabel}>
						<Dropdown
							value={projectId}
							onChange={chooseProject}
							ariaLabel={ASSIGNMENT_COPY.projectLabel}
							placeholder={ASSIGNMENT_COPY.projectPlaceholder}
							options={projects.map((project) => ({
								value: project.id,
								label: projectOptionLabel(project, assignedIds.has(project.id)),
							}))}
						/>
						{selected && !selected.linked && (
							<p className="mt-1.5 text-xs text-muted-foreground">
								{ASSIGNMENT_COPY.placeHint}
							</p>
						)}
					</FieldLabel>

					{needsChoice && choices && (
						<fieldset
							aria-labelledby={questionId}
							className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3"
						>
							<p
								id={questionId}
								className="text-sm font-semibold text-foreground"
							>
								{ASSIGNMENT_COPY.clientQuestion}
							</p>
							{choices.map((choice, index) => (
								<label
									key={choice.id}
									className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
								>
									<input
										type="radio"
										name={`${questionId}-client`}
										value={choice.id}
										checked={clientEngagementId === choice.id}
										onChange={() => setClientEngagementId(choice.id)}
										className="h-4 w-4 accent-primary"
									/>
									{choiceLabels[index]}
								</label>
							))}
						</fieldset>
					)}

					<FieldLabel label={ASSIGNMENT_COPY.roleLabel} optional>
						<input
							id={roleId}
							aria-label={ASSIGNMENT_COPY.roleLabel}
							type="text"
							value={role}
							maxLength={ASSIGNMENT_ROLE_TITLE_MAX}
							placeholder={ASSIGNMENT_COPY.rolePlaceholder}
							onChange={(e) => setRole(e.target.value)}
							className={INPUT_CLASS}
						/>
					</FieldLabel>

					<FieldLabel label={ASSIGNMENT_COPY.startLabel} optional>
						<input
							id={startId}
							aria-label={ASSIGNMENT_COPY.startLabel}
							type="datetime-local"
							value={start}
							max={nowLocalInput()}
							onChange={(e) => setStart(e.target.value)}
							className={INPUT_CLASS}
						/>
						<p className="mt-1.5 text-xs text-muted-foreground">
							{ASSIGNMENT_COPY.startHint}
						</p>
					</FieldLabel>

					<p className="text-xs leading-5 text-muted-foreground">
						{assignmentGrantNote(authority)}
					</p>
				</div>
			)}

			{error && (
				<p role="alert" className="mt-4 text-sm text-destructive">
					{error}
				</p>
			)}
		</AppDialog>
	);
}
