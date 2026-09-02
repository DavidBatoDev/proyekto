import { Building2, Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { workspaceMemberName } from "@/components/workspace/settings/memberName";
import { WorkspaceSettingsGate } from "@/components/workspace/settings/WorkspaceSettingsGate";
import { useToast } from "@/hooks/useToast";
import {
	useUpdateWorkspaceMutation,
	useWorkspaceMembersQuery,
} from "@/hooks/useWorkspaceQueries";
import type { Workspace, WorkspaceMember } from "@/services/workspaces.service";

export function WorkspaceGeneralSettings() {
	return (
		<WorkspaceSettingsGate>
			{(workspace) => (
				// Keyed so switching workspaces resets the form instead of carrying
				// draft text from the previous one.
				<GeneralSettingsContent key={workspace.id} workspace={workspace} />
			)}
		</WorkspaceSettingsGate>
	);
}

function GeneralSettingsContent({ workspace }: { workspace: Workspace }) {
	const canEdit =
		workspace.my_role === "owner" || workspace.my_role === "admin";
	const updateWorkspace = useUpdateWorkspaceMutation(workspace.id);
	const membersQuery = useWorkspaceMembersQuery(workspace.id);
	const { success, error: toastError } = useToast();

	const [name, setName] = useState(workspace.name);
	const [description, setDescription] = useState(workspace.description ?? "");

	const owners = (membersQuery.data ?? []).filter(
		(member) => member.role === "owner",
	);

	const dirty =
		name.trim() !== workspace.name ||
		description.trim() !== (workspace.description ?? "");

	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		const trimmedName = name.trim();
		if (!trimmedName || !dirty || updateWorkspace.isPending) return;
		updateWorkspace.mutate(
			{ name: trimmedName, description: description.trim() },
			{
				onSuccess: () => success("Workspace updated."),
				onError: (err) =>
					toastError(
						err instanceof Error ? err.message : "Failed to update workspace",
					),
			},
		);
	};

	return (
		<div className="app-fade-in">
			<header className="mb-8 flex items-start gap-4">
				<div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary sm:flex">
					<Building2 className="h-6 w-6" />
				</div>
				<div>
					<h1 className="text-3xl font-semibold tracking-tight text-foreground">
						General
					</h1>
					<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
						The name and description every member of this workspace sees.
					</p>
				</div>
			</header>

			<section className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-(--app-shadow-sm) sm:p-6">
				{canEdit ? (
					<form onSubmit={onSubmit} className="space-y-5">
						<div>
							<label
								htmlFor="workspace-name"
								className="block text-sm font-medium text-foreground"
							>
								Workspace name
							</label>
							<input
								id="workspace-name"
								type="text"
								value={name}
								onChange={(event) => setName(event.target.value)}
								className="mt-1.5 w-full max-w-md rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
							/>
						</div>

						<div>
							<label
								htmlFor="workspace-description"
								className="block text-sm font-medium text-foreground"
							>
								Description{" "}
								<span className="font-normal text-muted-foreground">
									(optional)
								</span>
							</label>
							<textarea
								id="workspace-description"
								value={description}
								onChange={(event) => setDescription(event.target.value)}
								rows={3}
								placeholder="What this workspace is for"
								className="mt-1.5 w-full max-w-xl rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
							/>
						</div>

						<div className="flex items-center gap-3">
							<button
								type="submit"
								disabled={!dirty || !name.trim() || updateWorkspace.isPending}
								className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{updateWorkspace.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : null}
								Save changes
							</button>
						</div>
					</form>
				) : (
					<div className="space-y-5">
						<div>
							<p className="text-sm font-medium text-foreground">
								Workspace name
							</p>
							<p className="mt-1 text-sm text-muted-foreground">
								{workspace.name}
							</p>
						</div>
						<div>
							<p className="text-sm font-medium text-foreground">Description</p>
							<p className="mt-1 text-sm text-muted-foreground">
								{workspace.description || "No description yet."}
							</p>
						</div>
						<p className="border-t border-border pt-4 text-xs text-muted-foreground">
							Only workspace owners and admins can change these details.
						</p>
					</div>
				)}
			</section>

			<section className="mt-6 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-(--app-shadow-sm) sm:p-6">
				<h2 className="text-sm font-semibold text-foreground">Owners</h2>
				<p className="mt-1 text-xs text-muted-foreground">
					Owners manage members, billing, and this workspace itself.
				</p>
				{membersQuery.isLoading ? (
					<div className="flex items-center gap-2 py-6 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						<span className="text-sm">Loading owners…</span>
					</div>
				) : owners.length === 0 ? (
					<p className="py-6 text-sm text-muted-foreground">
						The owners of this workspace could not be loaded right now.
					</p>
				) : (
					<ul className="mt-4 space-y-3">
						{owners.map((owner) => (
							<OwnerRow key={owner.id} owner={owner} />
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

function OwnerRow({ owner }: { owner: WorkspaceMember }) {
	const displayName = workspaceMemberName(owner);
	return (
		<li className="flex items-center gap-3">
			{owner.user?.avatar_url ? (
				<img
					src={owner.user.avatar_url}
					alt={displayName}
					className="h-9 w-9 rounded-full border border-border object-cover"
				/>
			) : (
				<span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold text-foreground">
					{displayName.charAt(0).toUpperCase()}
				</span>
			)}
			<span className="min-w-0">
				<span className="block truncate text-sm font-medium text-foreground">
					{displayName}
				</span>
				{owner.user?.email ? (
					<span className="block truncate text-xs text-muted-foreground">
						{owner.user.email}
					</span>
				) : null}
			</span>
		</li>
	);
}
