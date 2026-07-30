import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	Building2,
	Check,
	Loader2,
	SlidersHorizontal,
	UserMinus,
	Users,
} from "lucide-react";
import { AppDialog } from "@/components/common/AppDialog";
import { Avatar } from "@/components/common/Avatar";
import { displayNameOf } from "@/components/common/MemberDisplay";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { projectKeys } from "@/queries/project";
import { projectService } from "@/services/project.service";
import { describeAccess } from "./accessLanguage";
import type { PersonAccess } from "./useProjectPeople";

/**
 * "What can this person actually do here?" — answered in plain language.
 *
 * A drawer rather than a page because the question is almost always asked
 * *about a row you are looking at*; navigating away and back was the single
 * worst thing about the old permissions surface.
 *
 * The roster's `likelyCanEdit` is an approximation derived from role, because
 * the members payload carries no resolved permissions. This fetches the
 * authoritative per-member permissions on open, so the detail view is exact
 * even though the summary above it is not.
 */
export function PersonAccessDrawer({
	projectId,
	person,
	onClose,
}: {
	projectId: string;
	person: PersonAccess;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();

	const permsQuery = useQuery({
		queryKey: ["project", "member-permissions", projectId, person.memberId],
		queryFn: () =>
			projectService.getMemberPermissions(projectId, person.memberId),
		staleTime: 30_000,
	});

	const removeMutation = useMutation({
		// removeMember takes the project_access row id, not the user id.
		mutationFn: () => projectService.removeMember(projectId, person.memberId),
		onSuccess: () => {
			toast.success("Removed from the project");
			void qc.invalidateQueries({ queryKey: projectKeys.members(projectId) });
			void qc.invalidateQueries({ queryKey: ["project", projectId, "teams"] });
			onClose();
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const name = displayNameOf(person.user, person.userId ?? undefined);
	const described = permsQuery.data ? describeAccess(permsQuery.data) : null;

	const askRemove = async () => {
		const ok = await confirm({
			title: `Remove ${name} from this project?`,
			message: person.teamIds.length
				? "They lose access to this project immediately. They stay on their team — this only removes them here."
				: "They lose access to this project immediately. You can add them again later.",
			confirmLabel: "Remove from project",
			tone: "danger",
		});
		if (ok) removeMutation.mutate();
	};

	return (
		<AppDialog
			open
			onClose={onClose}
			variant="drawer-right"
			size="md"
			busy={removeMutation.isPending}
			title="Access"
		>
			<div className="space-y-6">
				<div className="flex items-center gap-3">
					<Avatar
						user={person.user}
						fallbackId={person.userId ?? undefined}
						size="lg"
						badge={person.isExternal ? { kind: "external" } : null}
					/>
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold text-foreground">
							{name}
						</p>
						<p className="text-xs capitalize text-muted-foreground">
							{person.role}
							{person.position ? ` · ${person.position}` : ""}
							{person.isExternal ? " · External" : ""}
						</p>
					</div>
				</div>

				{permsQuery.isPending ? (
					<div className="flex justify-center py-8">
						<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
					</div>
				) : permsQuery.isError ? (
					<p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
						{(permsQuery.error as Error).message}
					</p>
				) : described ? (
					<>
						<Section title="What they can see">
							{described.canSee.length ? (
								<div className="flex flex-wrap gap-1.5">
									{described.canSee.map((label) => (
										<span
											key={label}
											className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-foreground"
										>
											<Check className="h-3 w-3 text-success" />
											{label}
										</span>
									))}
								</div>
							) : (
								<p className="text-xs text-muted-foreground">
									No pages on this project.
								</p>
							)}
							{described.cannotSee.length > 0 && (
								<p className="mt-2 text-[11px] text-muted-foreground">
									Can't see: {described.cannotSee.join(", ")}.
								</p>
							)}
						</Section>

						<Section title="What they can change">
							{described.canChange.length ? (
								<ul className="space-y-1">
									{described.canChange.map((label) => (
										<li
											key={label}
											className="flex items-start gap-1.5 text-xs text-foreground"
										>
											<Check className="mt-0.5 h-3 w-3 shrink-0 text-success" />
											{label}
										</li>
									))}
								</ul>
							) : (
								<p className="text-xs text-muted-foreground">
									{described.readOnlyNote ?? "Nothing."}
								</p>
							)}
						</Section>
					</>
				) : null}

				<Section title="Where this access comes from">
					<ul className="space-y-2">
						{person.sources.map((source) => (
							<li
								key={source.label}
								className="flex items-start gap-2 text-xs text-muted-foreground"
							>
								{source.kind === "team" ? (
									<Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								) : (
									<Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								)}
								{source.label}
							</li>
						))}
					</ul>
				</Section>

				<div className="flex flex-wrap gap-2 border-t border-border pt-4">
					{person.canEditPermissions && (
						<Link
							to="/project/$projectId/team"
							params={{ projectId }}
							search={{ matrix: person.memberId }}
							className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted"
						>
							<SlidersHorizontal className="h-3.5 w-3.5" />
							Change permission by permission
						</Link>
					)}
					{person.canRemove && (
						<button
							type="button"
							onClick={() => void askRemove()}
							disabled={removeMutation.isPending}
							className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
						>
							<UserMinus className="h-3.5 w-3.5" />
							Remove from project
						</button>
					)}
				</div>
			</div>
		</AppDialog>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				{title}
			</p>
			{children}
		</div>
	);
}
