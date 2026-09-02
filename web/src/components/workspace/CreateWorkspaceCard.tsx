import { type FormEvent, useState } from "react";
import { useEnterWorkspace } from "@/hooks/useEnterWorkspace";
import { useToast } from "@/hooks/useToast";
import { useCreateWorkspaceMutation } from "@/hooks/useWorkspaceQueries";

/**
 * The landing for an account with no workspace at all. That state should be
 * unreachable — the server provisions one at signup — but self-healing beats a
 * dead end if that backstop ever fails. Creating one enters it.
 */
export function CreateWorkspaceCard() {
	const createWorkspace = useCreateWorkspaceMutation();
	const enterWorkspace = useEnterWorkspace();
	const { success, error: toastError } = useToast();
	const [name, setName] = useState("");

	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed || createWorkspace.isPending) return;
		createWorkspace.mutate(
			{ name: trimmed },
			{
				onSuccess: (created) => {
					success("Workspace created.");
					enterWorkspace(created);
				},
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
