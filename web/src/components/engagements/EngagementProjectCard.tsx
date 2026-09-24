import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { FolderKanban, FolderPlus, Link2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { Dropdown } from "@/components/common/Dropdown";
import { TextField } from "@/components/common/FormFields";
import { useToast } from "@/hooks/useToast";
import {
	type Engagement,
	engagementService,
} from "@/services/engagement.service";
import { getCurrentWorkspaceId } from "@/stores/workspaceStore";

/**
 * The step after signing, on the consultant's side of a client engagement:
 * put the engagement to work on a project under the team the contract was
 * signed for — a new one, or one they already run. Linking it opens the
 * project's finance under the team book.
 *
 * Renders nothing for any other seat or kind: the client does not create the
 * consultant's project, and a talent engagement is placed on work by
 * assignment, not by creating a project.
 */
export function EngagementProjectCard({
	engagement,
}: {
	engagement: Engagement;
}) {
	const [mode, setMode] = useState<"create" | "link" | null>(null);
	const eligible =
		engagement.kind === "client_services" &&
		engagement.viewer_capacity === "consultant" &&
		engagement.status === "active";
	if (!eligible) return null;

	const activeLinks = engagement.project_links.filter(
		(link) => link.status === "active" && link.project_id,
	);

	if (activeLinks.length > 0) {
		return (
			<AppSurfaceCard className="p-5">
				<h2 className="mb-1.5 text-sm font-semibold text-foreground">
					Project
				</h2>
				<ul className="space-y-2">
					{activeLinks.map((link) => (
						<li
							key={link.id}
							className="flex flex-wrap items-center justify-between gap-3"
						>
							<span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
								<FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
								<span className="truncate">{link.project_title_snapshot}</span>
							</span>
							<Link
								to="/project/$projectId/overview"
								params={{ projectId: link.project_id as string }}
								className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
							>
								Open project
							</Link>
						</li>
					))}
				</ul>
			</AppSurfaceCard>
		);
	}

	return (
		<AppSurfaceCard className="border-primary/30 p-5">
			<h2 className="text-sm font-semibold text-foreground">
				Set up the project
			</h2>
			<p className="mt-1 text-sm leading-6 text-muted-foreground">
				Both parties have signed. Create the project this work happens in
				{engagement.viewer_team ? (
					<>
						{" "}
						under{" "}
						<span className="font-semibold text-foreground">
							{engagement.viewer_team.name}
						</span>
					</>
				) : null}
				, or link one you already run. Its finance opens with it.
			</p>
			<div className="mt-3 flex flex-wrap gap-2">
				<button
					type="button"
					onClick={() => setMode("create")}
					className="app-cta inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white"
				>
					<FolderPlus className="h-4 w-4" />
					Create project
				</button>
				<button
					type="button"
					onClick={() => setMode("link")}
					className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
				>
					<Link2 className="h-4 w-4" />
					Link existing
				</button>
			</div>
			{mode && (
				<SetUpProjectDialog
					engagementId={engagement.id}
					mode={mode}
					onModeChange={setMode}
					onClose={() => setMode(null)}
				/>
			)}
		</AppSurfaceCard>
	);
}

function SetUpProjectDialog({
	engagementId,
	mode,
	onModeChange,
	onClose,
}: {
	engagementId: string;
	mode: "create" | "link";
	onModeChange: (mode: "create" | "link") => void;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const navigate = useNavigate();
	const defaultsQuery = useQuery({
		queryKey: ["engagement", engagementId, "project-defaults"],
		queryFn: () => engagementService.projectDefaults(engagementId),
	});
	const defaults = defaultsQuery.data;

	const [title, setTitle] = useState("");
	const [projectId, setProjectId] = useState("");
	const [teamId, setTeamId] = useState("");
	useEffect(() => {
		if (!defaults) return;
		setTitle((current) => current || defaults.title);
		setProjectId(
			(current) =>
				current ||
				defaults.candidates.find((c) => c.team_attached)?.id ||
				defaults.candidates[0]?.id ||
				"",
		);
		setTeamId(
			(current) =>
				current ||
				(defaults.owned_teams.length === 1 ? defaults.owned_teams[0].id : ""),
		);
	}, [defaults]);

	// Only contracts signed before seats carried a team need the question.
	const needsTeam = Boolean(defaults && !defaults.team);

	const mutation = useMutation({
		mutationFn: () =>
			engagementService.setUpProject(
				engagementId,
				mode === "create"
					? {
							mode: "create",
							title: title.trim(),
							currency: defaults?.currency ?? undefined,
							workspace_id: getCurrentWorkspaceId() ?? undefined,
							team_id: needsTeam ? teamId || undefined : undefined,
						}
					: {
							mode: "link",
							project_id: projectId,
							team_id: needsTeam ? teamId || undefined : undefined,
						},
			),
		onSuccess: (result) => {
			void qc.invalidateQueries({ queryKey: ["engagements"] });
			void qc.invalidateQueries({ queryKey: ["engagement", engagementId] });
			void qc.invalidateQueries({ queryKey: ["finance-books"] });
			toast.success(
				result.finance_book_id
					? `${result.project_title} is set up — its finance is open.`
					: result.team_book_exists
						? `${result.project_title} is set up.`
						: `${result.project_title} is set up. Set up team finance to track its money.`,
			);
			onClose();
			void navigate({
				to: "/project/$projectId/overview",
				params: { projectId: result.project_id },
			});
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const canSubmit =
		!mutation.isPending &&
		Boolean(defaults) &&
		(!needsTeam || Boolean(teamId)) &&
		(mode === "create" ? Boolean(title.trim()) : Boolean(projectId));

	return (
		<AppDialog
			open
			onClose={onClose}
			busy={mutation.isPending}
			title="Set up the project"
			description={
				defaults?.team
					? `It lands under ${defaults.team.name}, the team this contract was signed for.`
					: "Choose which of your teams the project lands under."
			}
			footer={
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						disabled={mutation.isPending}
						className="rounded-lg border border-border px-3.5 py-2 text-sm font-semibold text-foreground hover:bg-muted"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => mutation.mutate()}
						disabled={!canSubmit}
						className="app-cta inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
					>
						{mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
						{mode === "create" ? "Create project" : "Link project"}
					</button>
				</div>
			}
		>
			{defaultsQuery.isPending ? (
				<div className="flex justify-center py-8">
					<Loader2 className="h-5 w-5 animate-spin text-primary" />
				</div>
			) : defaultsQuery.isError ? (
				<p className="text-sm text-destructive">
					{(defaultsQuery.error as Error).message}
				</p>
			) : (
				<div className="space-y-4">
					<div className="inline-flex rounded-lg border border-border p-0.5 text-xs font-semibold">
						{(["create", "link"] as const).map((option) => (
							<button
								key={option}
								type="button"
								onClick={() => onModeChange(option)}
								className={`rounded-md px-3 py-1.5 transition ${
									mode === option
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:text-foreground"
								}`}
							>
								{option === "create" ? "New project" : "Existing project"}
							</button>
						))}
					</div>

					{needsTeam && (
						<div className="space-y-1">
							<span className="text-xs font-semibold text-muted-foreground">
								Team
							</span>
							<Dropdown
								value={teamId}
								onChange={setTeamId}
								options={[
									{ value: "", label: "Choose a team…" },
									...(defaults?.owned_teams ?? []).map((team) => ({
										value: team.id,
										label: team.name,
									})),
								]}
							/>
						</div>
					)}

					{mode === "create" ? (
						<TextField label="Project name" value={title} onChange={setTitle} />
					) : (defaults?.candidates.length ?? 0) === 0 ? (
						<p className="text-sm text-muted-foreground">
							You don&apos;t own any other project yet. Create a new one
							instead.
						</p>
					) : (
						<div className="space-y-1">
							<span className="text-xs font-semibold text-muted-foreground">
								Project you run
							</span>
							<Dropdown
								value={projectId}
								onChange={setProjectId}
								options={(defaults?.candidates ?? []).map((project) => ({
									value: project.id,
									label: project.team_attached
										? `${project.title} · on this team`
										: project.title,
								}))}
							/>
							<p className="text-xs text-muted-foreground">
								If the team isn&apos;t on that project yet, it is attached.
							</p>
						</div>
					)}
				</div>
			)}
		</AppDialog>
	);
}
