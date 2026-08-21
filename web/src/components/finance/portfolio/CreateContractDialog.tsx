import { useMutation } from "@tanstack/react-query";
import { Check, Loader2, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import {
	type ContractRelationshipKind,
	type ContractScopeMode,
	contractService,
} from "@/services/contract.service";

export function CreateContractDialog({
	open,
	projects,
	loading,
	creating,
	initialProjectId,
	onClose,
	onCreate,
}: {
	open: boolean;
	projects: Array<{ id: string; title: string }>;
	loading: boolean;
	creating: boolean;
	/**
	 * Preselected when the dialog is opened from inside a project's finance
	 * view — otherwise the reader has to pick the project they are already
	 * looking at out of a list of every project they own.
	 */
	initialProjectId?: string;
	onClose: () => void;
	onCreate: (input: {
		project_id?: string | null;
		relationship_kind: ContractRelationshipKind;
		scope_mode: ContractScopeMode;
		counterparty_user_id?: string;
	}) => void;
}) {
	const [query, setQuery] = useState("");
	const [selectedProjectId, setSelectedProjectId] = useState<string>();
	const [relationshipKind, setRelationshipKind] =
		useState<ContractRelationshipKind>("client_services");
	const [scopeMode, setScopeMode] =
		useState<ContractScopeMode>("project_specific");
	const [counterpartyEmail, setCounterpartyEmail] = useState("");
	const [counterparty, setCounterparty] = useState<{
		id: string;
		display_name: string | null;
		email: string | null;
	} | null>(null);
	const resolveCounterpartyMutation = useMutation({
		mutationFn: (email: string) => contractService.resolveCounterparty(email),
		onSuccess: (resolved) => setCounterparty(resolved),
	});
	useEffect(() => {
		if (!open) return;
		setQuery("");
		setSelectedProjectId(initialProjectId);
		setRelationshipKind("client_services");
		setScopeMode("project_specific");
		setCounterpartyEmail("");
		setCounterparty(null);
	}, [open, initialProjectId]);
	if (!open) return null;
	const visibleProjects = projects.filter((project) =>
		project.title.toLowerCase().includes(query.trim().toLowerCase()),
	);
	/*
	 * Every contract names its counterparty, including a project-scoped client
	 * agreement. The Client used to be inferred from the project owner, which
	 * both contradicted the domain rule (a project does not know who is paying)
	 * and made project-scoped client contracts impossible to create at all.
	 */
	const requiresCounterparty = true;
	const canCreate =
		(scopeMode === "flexible" || Boolean(selectedProjectId)) &&
		(!requiresCounterparty || Boolean(counterparty));

	return (
		<ModalPortal>
			<div className="fixed inset-0 z-80 flex items-center justify-center p-4">
				<button
					type="button"
					aria-label="Close add contract dialog"
					onClick={onClose}
					className="absolute inset-0 bg-foreground/30 backdrop-blur-[1px]"
				/>
				<div
					role="dialog"
					aria-modal="true"
					aria-labelledby="create-contract-title"
					className="relative w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl"
				>
					<div className="flex items-start justify-between gap-4">
						<div>
							<h2
								id="create-contract-title"
								className="text-base font-semibold text-foreground"
							>
								Create a contract
							</h2>
							<p className="mt-1 text-xs leading-5 text-muted-foreground">
								Set up the relationship and scope. You will add the terms in the
								draft.
							</p>
						</div>
						<button
							type="button"
							onClick={onClose}
							className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
							aria-label="Close"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
					<div className="mt-4 grid grid-cols-2 gap-2">
						{(
							[
								["client_services", "Client hires Consultant"],
								["talent_services", "Consultant hires Talent"],
							] as const
						).map(([value, label]) => (
							<button
								type="button"
								key={value}
								onClick={() => setRelationshipKind(value)}
								className={`rounded-lg border px-3 py-2 text-left text-xs font-medium ${
									relationshipKind === value
										? "border-primary bg-primary/10 text-foreground"
										: "border-border text-muted-foreground hover:bg-muted"
								}`}
							>
								{label}
							</button>
						))}
					</div>
					<div className="mt-2 flex gap-2">
						{(
							[
								["project_specific", "One project"],
								["flexible", "Flexible"],
							] as const
						).map(([value, label]) => (
							<button
								type="button"
								key={value}
								onClick={() => setScopeMode(value)}
								className={`rounded-md px-2.5 py-1 text-xs font-medium ${
									scopeMode === value
										? "bg-foreground text-background"
										: "bg-muted text-muted-foreground hover:text-foreground"
								}`}
							>
								{label}
							</button>
						))}
					</div>
					{scopeMode === "project_specific" && (
						<>
							<div className="relative mt-4">
								<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
								<input
									autoFocus
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder="Search projects…"
									className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
								/>
							</div>
							<div className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-border p-1">
								{loading ? (
									<div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
										<Loader2 className="h-4 w-4 animate-spin" /> Loading
										projects…
									</div>
								) : visibleProjects.length ? (
									visibleProjects.map((project) => {
										const selected = project.id === selectedProjectId;
										return (
											<button
												type="button"
												key={project.id}
												onClick={() => setSelectedProjectId(project.id)}
												className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
													selected
														? "bg-primary/10 text-foreground"
														: "hover:bg-muted"
												}`}
											>
												<span className="truncate">{project.title}</span>
												{selected && (
													<Check className="h-4 w-4 shrink-0 text-primary" />
												)}
											</button>
										);
									})
								) : (
									<p className="px-3 py-8 text-center text-xs text-muted-foreground">
										No matching projects.
									</p>
								)}
							</div>
						</>
					)}
					{requiresCounterparty && (
						<div className="mt-4 rounded-lg border border-border p-3">
							<p className="text-xs font-medium text-foreground">
								{relationshipKind === "talent_services"
									? "Talent account"
									: "Client account"}
							</p>
							<p className="mt-1 text-[11px] text-muted-foreground">
								{relationshipKind === "talent_services"
									? "Enter their exact Proyekto email. Private Talent contracts do not require a public talent listing."
									: "Enter the paying client's exact Proyekto email. Who pays is a fact of the contract, not of the project."}
							</p>
							<div className="mt-2 flex gap-2">
								<input
									value={counterpartyEmail}
									onChange={(event) => {
										setCounterpartyEmail(event.target.value);
										setCounterparty(null);
									}}
									placeholder="person@example.com"
									className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"
								/>
								<button
									type="button"
									disabled={
										!counterpartyEmail.trim() ||
										resolveCounterpartyMutation.isPending
									}
									onClick={() =>
										resolveCounterpartyMutation.mutate(counterpartyEmail)
									}
									className="rounded-md bg-muted px-2.5 text-xs font-medium text-foreground disabled:opacity-50"
								>
									{resolveCounterpartyMutation.isPending
										? "Checking…"
										: "Confirm"}
								</button>
							</div>
							{counterparty && (
								<p className="mt-2 text-xs font-medium text-success-foreground">
									{counterparty.display_name || counterparty.email} confirmed
								</p>
							)}
							{resolveCounterpartyMutation.isError && (
								<p className="mt-2 text-xs text-destructive">
									{resolveCounterpartyMutation.error.message}
								</p>
							)}
						</div>
					)}
					<div className="mt-4 flex justify-end gap-2">
						<button
							type="button"
							onClick={onClose}
							disabled={creating}
							className="h-9 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
						>
							Cancel
						</button>
						<button
							type="button"
							disabled={!canCreate || creating}
							onClick={() =>
								onCreate({
									project_id:
										scopeMode === "project_specific" ? selectedProjectId : null,
									relationship_kind: relationshipKind,
									scope_mode: scopeMode,
									...(counterparty
										? { counterparty_user_id: counterparty.id }
										: {}),
								})
							}
							className="app-cta inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
						>
							{creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
							Create draft
						</button>
					</div>
				</div>
			</div>
		</ModalPortal>
	);
}
