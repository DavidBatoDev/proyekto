import { Loader2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useToast } from "@/hooks/useToast";
import {
	useCreateWorkspaceMutation,
	useCurrentWorkspace,
} from "@/hooks/useWorkspaceQueries";
import type { Workspace } from "@/services/workspaces.service";

interface WorkspaceSettingsGateProps {
	children: (workspace: Workspace) => ReactNode;
}

/**
 * Loading / no-workspace handling shared by every workspace settings page.
 *
 * The no-workspace card should be unreachable — the server provisions a
 * workspace at signup — but self-healing beats a dead end if that backstop
 * ever fails.
 */
export function WorkspaceSettingsGate({
	children,
}: WorkspaceSettingsGateProps) {
	const { workspace, workspaces, isLoading } = useCurrentWorkspace();

	if (isLoading) return <CenteredSpinner />;

	if (!workspace) {
		if (workspaces.length === 0) return <CreateWorkspaceCard />;
		// The list is here but the selection has not reconciled yet —
		// WorkspaceSelectionSync picks a default within a tick.
		return <CenteredSpinner />;
	}

	return <>{children(workspace)}</>;
}

function CenteredSpinner() {
	return (
		<div className="flex items-center justify-center py-24">
			<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
		</div>
	);
}

function CreateWorkspaceCard() {
	const createWorkspace = useCreateWorkspaceMutation();
	const { success, error: toastError } = useToast();
	const [name, setName] = useState("");

	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed || createWorkspace.isPending) return;
		createWorkspace.mutate(
			{ name: trimmed },
			{
				onSuccess: () => success("Workspace created."),
				onError: (err) =>
					toastError(
						err instanceof Error ? err.message : "Failed to create workspace",
					),
			},
		);
	};

	return (
		<div className="app-fade-in mx-auto max-w-lg rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-(--app-shadow-sm)">
			<h1 className="text-xl font-semibold text-foreground">
				Create your workspace
			</h1>
			<p className="mt-2 text-sm text-muted-foreground">
				Your account has no workspace yet. A workspace is where your teams,
				projects, and members live in Proyekto — create one to continue.
			</p>
			<form
				onSubmit={onSubmit}
				className="mt-5 flex flex-col gap-3 sm:flex-row"
			>
				<input
					type="text"
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="Workspace name"
					aria-label="Workspace name"
					className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
				/>
				<button
					type="submit"
					disabled={!name.trim() || createWorkspace.isPending}
					className="inline-flex shrink-0 items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{createWorkspace.isPending ? "Creating…" : "Create workspace"}
				</button>
			</form>
		</div>
	);
}
