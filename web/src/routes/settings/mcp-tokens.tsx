import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	AlertTriangle,
	BookOpen,
	Check,
	Copy,
	FolderKanban,
	KeyRound,
	Loader2,
	type LucideIcon,
	Map as MapIcon,
	MessagesSquare,
	Plus,
	ShieldCheck,
	Terminal,
	Trash2,
	X,
} from "lucide-react";
import { useId, useState } from "react";
import { API_BASE_URL } from "@/api/axios";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { useToast } from "@/hooks/useToast";
import {
	createMcpToken,
	listMcpTokens,
	MCP_READ_SCOPES,
	type McpScope,
	type McpTokenIssued,
	type McpTokenSummary,
	revokeMcpToken,
} from "@/services/mcp-tokens.service";
import { useAuthStore } from "@/stores/authStore";

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

const SCOPE_META: Record<
	McpScope,
	{ label: string; hint: string; Icon: LucideIcon }
> = {
	"projects:read": {
		label: "Projects",
		hint: "Projects, members & details",
		Icon: FolderKanban,
	},
	"roadmaps:read": {
		label: "Roadmaps & tasks",
		hint: "Roadmaps, epics, features, tasks",
		Icon: MapIcon,
	},
	"knowledge:read": {
		label: "Knowledge search",
		hint: "Chat, comments, briefs, activity",
		Icon: BookOpen,
	},
	"chat:read": {
		label: "Chat",
		hint: "Channels you belong to",
		Icon: MessagesSquare,
	},
};

function formatDate(value: string | null): string {
	if (!value) return "—";
	return new Date(value).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

type TokenStatus = "active" | "revoked" | "expired";
function tokenStatus(t: McpTokenSummary): TokenStatus {
	if (t.revoked_at) return "revoked";
	if (t.expires_at && new Date(t.expires_at).getTime() <= Date.now())
		return "expired";
	return "active";
}

function StatusPill({ status }: { status: TokenStatus }) {
	const config = {
		active: { dot: "bg-emerald-500", label: "Active", text: "text-foreground" },
		revoked: {
			dot: "bg-muted-foreground/50",
			label: "Revoked",
			text: "text-muted-foreground",
		},
		expired: {
			dot: "bg-amber-500",
			label: "Expired",
			text: "text-muted-foreground",
		},
	}[status];
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium ${config.text}`}
		>
			<span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
			{config.label}
		</span>
	);
}

function McpTokensPage() {
	const toast = useToast();
	const qc = useQueryClient();
	const nameId = useId();

	const [name, setName] = useState("");
	const [scopes, setScopes] = useState<McpScope[]>([...MCP_READ_SCOPES]);
	const [issued, setIssued] = useState<McpTokenIssued | null>(null);
	const [copiedToken, setCopiedToken] = useState(false);
	const [copiedEndpoint, setCopiedEndpoint] = useState(false);

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
			setCopiedToken(false);
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

	const copy = (text: string, set: (v: boolean) => void, message: string) => {
		navigator.clipboard.writeText(text);
		set(true);
		setTimeout(() => set(false), 2000);
		toast.success(message);
	};

	const tokens = tokensQuery.data ?? [];
	const activeCount = tokens.filter((t) => tokenStatus(t) === "active").length;

	return (
		<DashboardShell>
			<div className="app-fade-in mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
				{/* Header */}
				<div className="mb-8 flex items-start gap-4">
					<div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary sm:flex">
						<KeyRound className="h-6 w-6" />
					</div>
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
							Account settings
						</p>
						<h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
							MCP Access Tokens
						</h1>
						<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
							Personal Access Tokens let MCP hosts like Claude Code and Codex
							read your Proyekto data on your behalf. Every token is read-only,
							scoped to what you choose, and revocable at any time.
						</p>
					</div>
				</div>

				{/* Connect helper */}
				<section className="mb-6 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-(--app-shadow-sm)">
					<div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
						<div className="flex items-center gap-3">
							<Terminal className="h-5 w-5 shrink-0 text-muted-foreground" />
							<div>
								<p className="text-sm font-medium text-foreground">
									Server endpoint
								</p>
								<p className="text-xs text-muted-foreground">
									Point your MCP host here, with the token as a bearer
									credential.
								</p>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<code className="truncate rounded-lg border border-border bg-muted px-3 py-1.5 font-mono text-xs text-foreground">
								{MCP_ENDPOINT}
							</code>
							<button
								type="button"
								onClick={() =>
									copy(MCP_ENDPOINT, setCopiedEndpoint, "Endpoint copied")
								}
								aria-label="Copy endpoint URL"
								className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								{copiedEndpoint ? (
									<Check className="h-4 w-4 text-emerald-500" />
								) : (
									<Copy className="h-4 w-4" />
								)}
							</button>
						</div>
					</div>
				</section>

				{/* One-time reveal */}
				{issued && (
					<section className="app-slide-up mb-6 overflow-hidden rounded-2xl border border-primary/40 bg-primary/5 shadow-(--app-shadow-md)">
						<div className="flex items-start justify-between gap-4 px-5 py-5 sm:px-7">
							<div className="min-w-0 flex-1">
								<h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
									<ShieldCheck className="h-5 w-5 text-primary" />
									Copy your new token now
								</h2>
								<p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
									<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
									This is the only time the full token is shown. Store it
									somewhere safe — you won’t be able to see it again.
								</p>
								<div className="mt-4 flex items-center gap-2">
									<code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-sm text-foreground">
										{issued.token}
									</code>
									<button
										type="button"
										onClick={() =>
											copy(
												issued.token,
												setCopiedToken,
												"Token copied to clipboard",
											)
										}
										className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
									>
										{copiedToken ? (
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
				<section className="mb-6 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-(--app-shadow-sm)">
					<form onSubmit={handleCreate}>
						<div className="border-b border-border px-5 py-5 sm:px-7">
							<h2 className="text-base font-semibold">Generate a new token</h2>
							<p className="mt-1 text-sm text-muted-foreground">
								Name it after where you’ll use it, and grant only the scopes
								that host needs.
							</p>
						</div>

						<div className="flex flex-col gap-6 px-5 py-6 sm:px-7">
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
									className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/50"
								/>
							</div>

							<fieldset>
								<legend className="mb-1 text-sm font-medium text-foreground">
									Scopes
								</legend>
								<p className="mb-3 text-xs text-muted-foreground">
									All scopes are read-only. A token can only see what you can.
								</p>
								<div className="grid gap-2.5 sm:grid-cols-2">
									{MCP_READ_SCOPES.map((scope) => {
										const checked = scopes.includes(scope);
										const { label, hint, Icon } = SCOPE_META[scope];
										return (
											<button
												type="button"
												key={scope}
												aria-pressed={checked}
												onClick={() => toggleScope(scope)}
												className={`group relative flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-all ${
													checked
														? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
														: "border-border bg-background hover:border-primary/40 hover:bg-muted"
												}`}
											>
												<span
													className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
														checked
															? "bg-primary/15 text-primary"
															: "bg-muted text-muted-foreground group-hover:text-foreground"
													}`}
												>
													<Icon className="h-5 w-5" />
												</span>
												<span className="min-w-0 flex-1">
													<span className="block text-sm font-medium text-foreground">
														{label}
													</span>
													<span className="block text-xs text-muted-foreground">
														{hint}
													</span>
													<span className="mt-1 block font-mono text-[11px] text-muted-foreground/80">
														{scope}
													</span>
												</span>
												<span
													className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
														checked
															? "border-primary bg-primary text-primary-foreground"
															: "border-border bg-background"
													}`}
												>
													{checked && <Check className="h-3.5 w-3.5" />}
												</span>
											</button>
										);
									})}
								</div>
							</fieldset>

							<div className="flex items-center gap-3">
								<button
									type="submit"
									disabled={createMutation.isPending}
									className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-(--app-shadow-sm) transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
								>
									{createMutation.isPending ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<Plus className="h-4 w-4" />
									)}
									Generate token
								</button>
								<span className="text-xs text-muted-foreground">
									{scopes.length} scope{scopes.length === 1 ? "" : "s"} selected
								</span>
							</div>
						</div>
					</form>
				</section>

				{/* Existing tokens */}
				<section className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-(--app-shadow-sm)">
					<div className="flex items-center justify-between border-b border-border px-5 py-5 sm:px-7">
						<div>
							<h2 className="text-base font-semibold">Your tokens</h2>
							<p className="mt-1 text-sm text-muted-foreground">
								Revoke any you no longer use.
							</p>
						</div>
						{tokens.length > 0 && (
							<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
								{activeCount} active
							</span>
						)}
					</div>

					{tokensQuery.isLoading ? (
						<div className="flex items-center justify-center gap-2 px-5 py-14 text-sm text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" />
							Loading tokens…
						</div>
					) : tokensQuery.isError ? (
						<div className="px-5 py-14 text-center text-sm text-destructive">
							{(tokensQuery.error as Error).message}
						</div>
					) : tokens.length === 0 ? (
						<div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
							<div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
								<KeyRound className="h-5 w-5" />
							</div>
							<p className="text-sm font-medium text-foreground">
								No tokens yet
							</p>
							<p className="max-w-xs text-xs text-muted-foreground">
								Generate your first token above to connect an MCP host to
								Proyekto.
							</p>
						</div>
					) : (
						<ul className="divide-y divide-border">
							{tokens.map((t) => {
								const status = tokenStatus(t);
								const isRevoking =
									revokeMutation.isPending && revokeMutation.variables === t.id;
								return (
									<li
										key={t.id}
										className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between sm:px-7"
									>
										<div className="flex min-w-0 items-start gap-3">
											<div
												className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
													status === "active"
														? "bg-primary/10 text-primary"
														: "bg-muted text-muted-foreground"
												}`}
											>
												<KeyRound className="h-4 w-4" />
											</div>
											<div className="min-w-0">
												<div className="flex flex-wrap items-center gap-2">
													<span className="truncate font-medium text-foreground">
														{t.name}
													</span>
													<span className="font-mono text-xs text-muted-foreground">
														{t.token_prefix}…
													</span>
													<StatusPill status={status} />
												</div>
												<div className="mt-1.5 flex flex-wrap gap-1.5">
													{t.scopes.length ? (
														t.scopes.map((s) => (
															<span
																key={s}
																className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
															>
																{s}
															</span>
														))
													) : (
														<span className="text-xs text-muted-foreground">
															no scopes
														</span>
													)}
												</div>
												<div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
													<span>Created {formatDate(t.created_at)}</span>
													<span>
														Last used{" "}
														{t.last_used_at
															? formatDate(t.last_used_at)
															: "never"}
													</span>
												</div>
											</div>
										</div>
										{status !== "revoked" && (
											<button
												type="button"
												onClick={() => revokeMutation.mutate(t.id)}
												disabled={isRevoking}
												className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:border-destructive/40 hover:bg-destructive/10 disabled:opacity-60 sm:self-center"
											>
												{isRevoking ? (
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
