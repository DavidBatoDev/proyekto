import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	AlertTriangle,
	Check,
	Copy,
	KeyRound,
	Loader2,
	Plus,
	ShieldCheck,
	Trash2,
	X,
} from "lucide-react";
import { useId, useState } from "react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { useToast } from "@/hooks/useToast";
import { API_BASE_URL } from "@/api/axios";
import { useAuthStore } from "@/stores/authStore";
import {
	createMcpToken,
	listMcpTokens,
	MCP_READ_SCOPES,
	MCP_SCOPE_LABELS,
	type McpScope,
	type McpTokenIssued,
	type McpTokenSummary,
	revokeMcpToken,
} from "@/services/mcp-tokens.service";

export const Route = createFileRoute("/settings/mcp-tokens")({
	beforeLoad: () => {
		if (!useAuthStore.getState().isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: McpTokensPage,
});

const mcpTokenKeys = { all: ["mcp-tokens"] as const };
const MCP_ENDPOINT = `${API_BASE_URL.replace(/\/$/, "")}/mcp`;

function formatDate(value: string | null): string {
	if (!value) return "—";
	return new Date(value).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function tokenStatus(t: McpTokenSummary): "revoked" | "expired" | "active" {
	if (t.revoked_at) return "revoked";
	if (t.expires_at && new Date(t.expires_at).getTime() <= Date.now())
		return "expired";
	return "active";
}

function McpTokensPage() {
	const toast = useToast();
	const qc = useQueryClient();
	const nameId = useId();

	const [name, setName] = useState("");
	const [scopes, setScopes] = useState<McpScope[]>([...MCP_READ_SCOPES]);
	const [issued, setIssued] = useState<McpTokenIssued | null>(null);
	const [copied, setCopied] = useState(false);

	const tokensQuery = useQuery({
		queryKey: mcpTokenKeys.all,
		queryFn: listMcpTokens,
		staleTime: 30 * 1000,
	});

	const createMutation = useMutation({
		mutationFn: createMcpToken,
		onSuccess: (data) => {
			setIssued(data);
			setName("");
			setCopied(false);
			qc.invalidateQueries({ queryKey: mcpTokenKeys.all });
			toast.success("Access token created");
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const revokeMutation = useMutation({
		mutationFn: revokeMcpToken,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: mcpTokenKeys.all });
			toast.success("Access token revoked");
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const toggleScope = (scope: McpScope) => {
		setScopes((prev) =>
			prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
		);
	};

	const handleCreate = (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) {
			toast.error("Give the token a name so you can recognize it later.");
			return;
		}
		if (scopes.length === 0) {
			toast.error("Select at least one scope.");
			return;
		}
		createMutation.mutate({ name: name.trim(), scopes });
	};

	const copyToken = () => {
		if (!issued) return;
		navigator.clipboard.writeText(issued.token);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
		toast.success("Token copied to clipboard");
	};

	const tokens = tokensQuery.data ?? [];

	return (
		<DashboardShell>
			<div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
				<div className="mb-8">
					<p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
						Account settings
					</p>
					<h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold tracking-tight text-foreground">
						<KeyRound className="h-7 w-7 text-primary" />
						MCP Access Tokens
					</h1>
					<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
						Personal Access Tokens let MCP hosts like Claude Code and Codex read
						your Proyekto data on your behalf. Each token is read-only, scoped,
						and can be revoked at any time. Point your host at{" "}
						<code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
							{MCP_ENDPOINT}
						</code>{" "}
						with the token as a bearer credential.
					</p>
				</div>

				{/* One-time reveal of a freshly created token */}
				{issued && (
					<section className="mb-8 overflow-hidden rounded-2xl border border-primary/40 bg-primary/5 shadow-(--app-shadow-sm)">
						<div className="flex items-start justify-between gap-4 px-5 py-5 sm:px-7">
							<div className="min-w-0">
								<h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
									<ShieldCheck className="h-5 w-5 text-primary" />
									Copy your new token now
								</h2>
								<p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
									<AlertTriangle className="h-4 w-4 shrink-0 text-primary" />
									This is the only time the full token is shown. Store it
									somewhere safe — you can’t see it again.
								</p>
								<div className="mt-4 flex items-center gap-2">
									<code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground">
										{issued.token}
									</code>
									<button
										type="button"
										onClick={copyToken}
										className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-(--primary-dark)"
									>
										{copied ? (
											<>
												<Check className="h-4 w-4" /> Copied
											</>
										) : (
											<>
												<Copy className="h-4 w-4" /> Copy
											</>
										)}
									</button>
								</div>
							</div>
							<button
								type="button"
								onClick={() => setIssued(null)}
								aria-label="Dismiss"
								className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								<X className="h-5 w-5" />
							</button>
						</div>
					</section>
				)}

				{/* Create form */}
				<section className="mb-8 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-(--app-shadow-sm)">
					<form onSubmit={handleCreate}>
						<div className="border-b border-border px-5 py-5 sm:px-7">
							<h2 className="text-base font-semibold">Generate a new token</h2>
							<p className="mt-1 text-sm text-muted-foreground">
								Name it after where you’ll use it, and grant only the scopes
								that host needs.
							</p>
						</div>

						<div className="flex flex-col gap-5 px-5 py-6 sm:px-7">
							<div className="flex flex-col gap-2">
								<label
									htmlFor={nameId}
									className="text-sm font-medium text-foreground"
								>
									Token name
								</label>
								<input
									id={nameId}
									type="text"
									value={name}
									maxLength={120}
									onChange={(e) => setName(e.target.value)}
									placeholder="e.g. My laptop — Claude Code"
									className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
								/>
							</div>

							<fieldset className="flex flex-col gap-2">
								<legend className="mb-1 text-sm font-medium text-foreground">
									Scopes
								</legend>
								<div className="grid gap-2 sm:grid-cols-2">
									{MCP_READ_SCOPES.map((scope) => {
										const checked = scopes.includes(scope);
										return (
											<label
												key={scope}
												className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
													checked
														? "border-primary/50 bg-primary/5 text-foreground"
														: "border-border bg-background text-muted-foreground hover:bg-muted"
												}`}
											>
												<input
													type="checkbox"
													checked={checked}
													onChange={() => toggleScope(scope)}
													className="h-4 w-4 accent-primary"
												/>
												<span className="flex flex-col">
													<span className="font-medium text-foreground">
														{MCP_SCOPE_LABELS[scope]}
													</span>
													<span className="font-mono text-xs text-muted-foreground">
														{scope}
													</span>
												</span>
											</label>
										);
									})}
								</div>
							</fieldset>

							<div>
								<button
									type="submit"
									disabled={createMutation.isPending}
									className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-(--primary-dark) disabled:opacity-60"
								>
									{createMutation.isPending ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<Plus className="h-4 w-4" />
									)}
									Generate token
								</button>
							</div>
						</div>
					</form>
				</section>

				{/* Existing tokens */}
				<section className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-(--app-shadow-sm)">
					<div className="border-b border-border px-5 py-5 sm:px-7">
						<h2 className="text-base font-semibold">Your tokens</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							Tokens you’ve generated. Revoke any you no longer use.
						</p>
					</div>

					{tokensQuery.isLoading ? (
						<div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" />
							Loading tokens…
						</div>
					) : tokensQuery.isError ? (
						<div className="px-5 py-12 text-center text-sm text-destructive">
							{(tokensQuery.error as Error).message}
						</div>
					) : tokens.length === 0 ? (
						<div className="px-5 py-12 text-center text-sm text-muted-foreground">
							You haven’t created any tokens yet.
						</div>
					) : (
						<ul className="divide-y divide-border">
							{tokens.map((t) => {
								const status = tokenStatus(t);
								return (
									<li
										key={t.id}
										className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7"
									>
										<div className="min-w-0">
											<div className="flex flex-wrap items-center gap-2">
												<span className="font-medium text-foreground">
													{t.name}
												</span>
												<span className="font-mono text-xs text-muted-foreground">
													{t.token_prefix}…
												</span>
												{status === "revoked" && (
													<span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
														Revoked
													</span>
												)}
												{status === "expired" && (
													<span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
														Expired
													</span>
												)}
												{status === "active" && (
													<span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
														Active
													</span>
												)}
											</div>
											<div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
												<span>{t.scopes.join(", ") || "no scopes"}</span>
												<span>Created {formatDate(t.created_at)}</span>
												<span>
													Last used{" "}
													{t.last_used_at
														? formatDate(t.last_used_at)
														: "never"}
												</span>
											</div>
										</div>
										{status !== "revoked" && (
											<button
												type="button"
												onClick={() => revokeMutation.mutate(t.id)}
												disabled={
													revokeMutation.isPending &&
													revokeMutation.variables === t.id
												}
												className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-border px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60 sm:self-auto"
											>
												{revokeMutation.isPending &&
												revokeMutation.variables === t.id ? (
													<Loader2 className="h-4 w-4 animate-spin" />
												) : (
													<Trash2 className="h-4 w-4" />
												)}
												Revoke
											</button>
										)}
									</li>
								);
							})}
						</ul>
					)}
				</section>
			</div>
		</DashboardShell>
	);
}
