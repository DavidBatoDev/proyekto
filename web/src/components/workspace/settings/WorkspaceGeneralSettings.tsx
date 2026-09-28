import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, Lock } from "lucide-react";
import { type FormEvent, useState } from "react";
import { workspaceMemberName } from "@/components/workspace/settings/memberName";
import {
	SettingsAvatar,
	SettingsNotice,
	SettingsPageHeader,
	SettingsRow,
	SettingsRows,
	SettingsSection,
	settingsButton,
	settingsInput,
} from "@/components/workspace/settings/SettingsPrimitives";
import { WorkspaceSettingsGate } from "@/components/workspace/settings/WorkspaceSettingsGate";
import { useToast } from "@/hooks/useToast";
import {
	useUpdateWorkspaceMutation,
	useWorkspaceMembersQuery,
} from "@/hooks/useWorkspaceQueries";
import { cn } from "@/lib/utils";
import {
	isValidWorkspaceSlug,
	normalizeWorkspaceSlug,
} from "@/lib/workspaceSlug";
import { workspaceKeys } from "@/queries/workspaces";
import type { Workspace, WorkspaceMember } from "@/services/workspaces.service";
import { useUser } from "@/stores/authStore";

const fieldLabel = "block text-sm font-medium text-foreground";
const fieldHint = "mt-2 text-xs leading-relaxed text-muted-foreground";

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
	// Renaming the URL handle breaks every link that carries it, so only an
	// owner may. The backend enforces the same split.
	const canEditSlug = workspace.my_role === "owner";
	const updateWorkspace = useUpdateWorkspaceMutation(workspace.id);
	const membersQuery = useWorkspaceMembersQuery(workspace.id);
	const { success, error: toastError } = useToast();
	const user = useUser();
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	const [name, setName] = useState(workspace.name);
	const [description, setDescription] = useState(workspace.description ?? "");
	const [slug, setSlug] = useState(workspace.slug);
	const slugChanged = canEditSlug && slug !== workspace.slug;
	const slugValid = isValidWorkspaceSlug(slug);
	const slugInvalid = slugChanged && !slugValid;
	const origin = typeof window === "undefined" ? "" : window.location.origin;

	const owners = (membersQuery.data ?? []).filter(
		(member) => member.role === "owner",
	);

	const dirty =
		name.trim() !== workspace.name ||
		description.trim() !== (workspace.description ?? "") ||
		slugChanged;

	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		const trimmedName = name.trim();
		if (!trimmedName || !dirty || updateWorkspace.isPending) return;
		if (slugChanged && !slugValid) return;
		updateWorkspace.mutate(
			{
				name: trimmedName,
				description: description.trim(),
				...(slugChanged ? { slug } : {}),
			},
			{
				onSuccess: (updated) => {
					success("Workspace updated.");
					if (updated.slug === workspace.slug) return;
					// The page's own URL just changed. Patch the cached list first so
					// the /w/$workspaceSlug layout resolves the new handle without a
					// round trip, then move to it.
					if (user?.id) {
						queryClient.setQueryData<Workspace[]>(
							workspaceKeys.mine(user.id),
							(list) =>
								list?.map((item) =>
									item.id === updated.id ? { ...item, ...updated } : item,
								),
						);
					}
					void navigate({
						to: "/w/$workspaceSlug/settings",
						params: { workspaceSlug: updated.slug },
						replace: true,
					});
				},
				onError: (err) =>
					toastError(
						err instanceof Error ? err.message : "Failed to update workspace",
					),
			},
		);
	};

	return (
		<div className="app-fade-in">
			<SettingsPageHeader
				title="General"
				description="The name and description every member of this workspace sees."
			/>

			<SettingsSection
				id="workspace-details"
				title="Workspace details"
				description="What this workspace is called, where it lives, and what it is for."
			>
				{canEdit ? (
					<form onSubmit={onSubmit} className="w-full max-w-xl space-y-7">
						<div>
							<label htmlFor="workspace-name" className={fieldLabel}>
								Workspace name
							</label>
							<input
								id="workspace-name"
								type="text"
								value={name}
								onChange={(event) => setName(event.target.value)}
								className={cn(settingsInput, "mt-2")}
							/>
						</div>

						<div>
							<label htmlFor="workspace-slug" className={fieldLabel}>
								URL handle
							</label>
							{canEditSlug ? (
								<>
									<div
										className={cn(
											"mt-2 flex w-full items-stretch overflow-hidden rounded-lg border bg-background transition-colors focus-within:ring-2",
											slugInvalid
												? "border-destructive focus-within:ring-destructive/20"
												: "border-input focus-within:border-primary focus-within:ring-primary/20",
										)}
									>
										<span className="flex select-none items-center border-r border-input bg-muted/40 px-3 font-mono text-sm text-muted-foreground">
											/w/
										</span>
										<input
											id="workspace-slug"
											type="text"
											value={slug}
											onChange={(event) =>
												setSlug(normalizeWorkspaceSlug(event.target.value))
											}
											spellCheck={false}
											autoComplete="off"
											aria-invalid={slugInvalid}
											aria-describedby="workspace-slug-hint"
											className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
										/>
									</div>
									<p
										id="workspace-slug-hint"
										className={cn(
											fieldHint,
											"break-all",
											slugInvalid ? "text-destructive" : undefined,
										)}
									>
										{slugInvalid
											? "Use 3 to 60 lowercase letters, numbers, and single hyphens."
											: slugChanged
												? "Old links keep working: they redirect to the new handle."
												: `${origin}/w/${workspace.slug}/dashboard`}
									</p>
								</>
							) : (
								<>
									<p className="mt-2 break-all text-sm text-foreground">
										{origin}/w/{workspace.slug}/dashboard
									</p>
									<p className={cn(fieldHint, "mt-1")}>
										Only the workspace owner can change the URL handle.
									</p>
								</>
							)}
						</div>

						<div>
							<label htmlFor="workspace-description" className={fieldLabel}>
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
								className={cn(settingsInput, "mt-2 resize-y leading-relaxed")}
							/>
						</div>

						<div className="flex items-center justify-end">
							<button
								type="submit"
								disabled={
									!dirty ||
									!name.trim() ||
									(slugChanged && !slugValid) ||
									updateWorkspace.isPending
								}
								className={settingsButton.primary}
							>
								{updateWorkspace.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : null}
								Save changes
							</button>
						</div>
					</form>
				) : (
					<>
						<SettingsRows>
							<SettingsRow label="Workspace name">
								<span className="max-w-[22rem] break-words text-foreground sm:text-right">
									{workspace.name}
								</span>
							</SettingsRow>
							<SettingsRow label="URL handle">
								<span className="max-w-[22rem] break-all text-muted-foreground sm:text-right">
									{origin}/w/{workspace.slug}/dashboard
								</span>
							</SettingsRow>
							<SettingsRow
								label="Description"
								below={
									<p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
										{workspace.description || "No description yet."}
									</p>
								}
							/>
						</SettingsRows>
						<SettingsNotice icon={Lock} className="mt-8">
							Only workspace owners and admins can change these details.
						</SettingsNotice>
					</>
				)}
			</SettingsSection>

			<SettingsSection
				id="workspace-owners"
				title="Owners"
				description="Owners manage members, billing, and this workspace itself."
			>
				{membersQuery.isLoading ? (
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						<span className="text-sm">Loading owners…</span>
					</div>
				) : owners.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						The owners of this workspace could not be loaded right now.
					</p>
				) : (
					<SettingsRows as="ul">
						{owners.map((owner) => (
							<OwnerRow key={owner.id} owner={owner} />
						))}
					</SettingsRows>
				)}
			</SettingsSection>
		</div>
	);
}

function OwnerRow({ owner }: { owner: WorkspaceMember }) {
	const displayName = workspaceMemberName(owner);
	return (
		<SettingsRow
			as="li"
			align="center"
			leading={
				<SettingsAvatar name={displayName} src={owner.user?.avatar_url} />
			}
			label={<span className="block truncate">{displayName}</span>}
			description={
				owner.user?.email ? (
					<span className="block truncate">{owner.user.email}</span>
				) : undefined
			}
		/>
	);
}
