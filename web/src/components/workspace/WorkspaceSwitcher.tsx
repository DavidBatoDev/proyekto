import { Link } from "@tanstack/react-router";
import {
	Building2,
	Check,
	ChevronsUpDown,
	Plus,
	Settings,
	UserPlus,
} from "lucide-react";
import { useRef, useState } from "react";
import { useDismissOnOutside } from "@/hooks/useDismissOnOutside";
import { useEnterWorkspace } from "@/hooks/useEnterWorkspace";
import {
	useCreateWorkspaceMutation,
	useCurrentWorkspace,
} from "@/hooks/useWorkspaceQueries";
import type { Workspace } from "@/services/workspaces.service";
import { useUser } from "@/stores/authStore";
import { WorkspaceInviteDialog } from "./WorkspaceInviteDialog";

function initials(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) return "?";
	const words = trimmed.split(/\s+/).slice(0, 2);
	return words.map((word) => word[0]?.toUpperCase() ?? "").join("");
}

/**
 * The organization currently open, and the way to move between organizations.
 *
 * Lives at the top of the sidebar rather than in the header: `SidebarContent`
 * is shared by the desktop rail and the mobile drawer, so one placement covers
 * both surfaces.
 */
export function WorkspaceSwitcher() {
	const user = useUser();
	const { workspace, workspaces, isLoading } = useCurrentWorkspace();
	const createWorkspace = useCreateWorkspaceMutation();
	const enterWorkspace = useEnterWorkspace();

	const [open, setOpen] = useState(false);
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");
	const [inviteOpen, setInviteOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);

	useDismissOnOutside(open, containerRef, () => {
		setOpen(false);
		setCreating(false);
	});

	if (!user) return null;

	if (isLoading && !workspace) {
		return (
			<div className="px-3 pt-3">
				<div className="h-11 w-full animate-pulse rounded-lg bg-sidebar-accent" />
			</div>
		);
	}

	// Switching lands on /w/<slug>/dashboard of the workspace just entered,
	// showing its skeletons while the data loads — the same move whether you
	// were on a settings page, deep in a project, or already on a dashboard.
	// The move itself (store, cache resets, navigation) lives in
	// useEnterWorkspace so creating and invite-accept behave identically.
	const enter = (next: Pick<Workspace, "id" | "slug">) => {
		setOpen(false);
		setCreating(false);
		enterWorkspace(next);
	};

	const select = (next: Workspace) => {
		enter(next);
	};

	const submitNew = async () => {
		const name = newName.trim();
		if (!name) return;
		const created = await createWorkspace.mutateAsync({ name });
		setNewName("");
		enter(created);
	};

	const label = workspace?.name ?? "No workspace";
	const canInvite =
		workspace?.my_role === "owner" || workspace?.my_role === "admin";

	return (
		<div ref={containerRef} className="relative px-3 pt-3">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-haspopup="menu"
				aria-expanded={open}
				className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-sidebar-accent"
			>
				<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
					{workspace ? (
						initials(workspace.name)
					) : (
						<Building2 className="h-4 w-4" />
					)}
				</span>
				<span className="min-w-0 flex-1 truncate text-sm font-semibold text-sidebar-foreground">
					{label}
				</span>
				<ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-foreground/55" />
			</button>

			{open && (
				<div
					role="menu"
					className="absolute left-3 right-3 z-50 mt-1 overflow-hidden rounded-lg border border-sidebar-border bg-sidebar shadow-lg"
				>
					<div className="max-h-64 overflow-y-auto py-1">
						{workspaces.map((item) => (
							<button
								key={item.id}
								type="button"
								role="menuitem"
								onClick={() => select(item)}
								className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent"
							>
								<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-sidebar-accent text-[11px] font-semibold">
									{initials(item.name)}
								</span>
								<span className="min-w-0 flex-1 truncate">{item.name}</span>
								{item.id === workspace?.id && (
									<Check className="h-4 w-4 shrink-0 text-primary" />
								)}
							</button>
						))}
					</div>

					<div className="border-t border-sidebar-border py-1">
						{creating ? (
							<div className="px-3 py-2">
								<input
									autoFocus
									value={newName}
									onChange={(event) => setNewName(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") void submitNew();
										if (event.key === "Escape") setCreating(false);
									}}
									placeholder="Workspace name"
									className="w-full rounded border border-sidebar-border bg-transparent px-2 py-1.5 text-sm text-sidebar-foreground outline-none focus:border-primary"
								/>
								<div className="mt-2 flex justify-end gap-2">
									<button
										type="button"
										onClick={() => setCreating(false)}
										className="rounded px-2 py-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent"
									>
										Cancel
									</button>
									<button
										type="button"
										disabled={!newName.trim() || createWorkspace.isPending}
										onClick={() => void submitNew()}
										className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-60"
									>
										{createWorkspace.isPending ? "Creating…" : "Create"}
									</button>
								</div>
							</div>
						) : (
							<>
								{workspace && (
									<Link
										to="/w/$workspaceSlug/settings"
										params={{ workspaceSlug: workspace.slug }}
										onClick={() => setOpen(false)}
										role="menuitem"
										className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
									>
										<Settings className="h-4 w-4" />
										Workspace settings
									</Link>
								)}
								{workspace && canInvite && (
									<button
										type="button"
										role="menuitem"
										onClick={() => {
											setInviteOpen(true);
											setOpen(false);
										}}
										className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
									>
										<UserPlus className="h-4 w-4" />
										Invite people
									</button>
								)}
								<button
									type="button"
									role="menuitem"
									onClick={() => setCreating(true)}
									className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
								>
									<Plus className="h-4 w-4" />
									Create workspace
								</button>
							</>
						)}
					</div>
				</div>
			)}

			{workspace && (
				<WorkspaceInviteDialog
					workspaceId={workspace.id}
					open={inviteOpen}
					onClose={() => setInviteOpen(false)}
				/>
			)}
		</div>
	);
}
