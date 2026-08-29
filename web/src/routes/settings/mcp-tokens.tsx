import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertTriangle,
	BookOpen,
	Check,
	ClipboardCheck,
	ClipboardList,
	Copy,
	FolderKanban,
	KeyRound,
	ListTodo,
	Loader2,
	type LucideIcon,
	Map as MapIcon,
	MessagesSquare,
	Pencil,
	PlugZap,
	Plus,
	Send,
	ShieldCheck,
	Sparkles,
	Terminal,
	Trash2,
	UserPlus,
	X,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { API_BASE_URL } from "@/api/axios";
import { ExplainerVideo } from "@/components/common/ExplainerVideo";
import { ModalPortal } from "@/components/common/ModalPortal";
import { useToast } from "@/hooks/useToast";
import {
	listMcpConnections,
	revokeMcpConnection,
} from "@/services/mcp-oauth.service";
import {
	createMcpToken,
	listAvailableMcpScopes,
	listMcpTokens,
	MCP_READ_SCOPES,
	MCP_WRITE_SCOPES,
	type McpScope,
	type McpTokenIssued,
	type McpTokenSummary,
	revokeMcpToken,
} from "@/services/mcp-tokens.service";

export const Route = createFileRoute("/settings/mcp-tokens")({
	beforeLoad: () => {},
	component: McpTokensPage,
});

const mcpTokenKeys = { all: ["mcp-tokens"] as const };
const mcpConnectionKeys = { all: ["mcp-connections"] as const };
const mcpScopeKeys = { all: ["mcp-available-scopes"] as const };
const MCP_ENDPOINT = `${API_BASE_URL.replace(/\/$/, "")}/mcp`;

/**
 * The explainer that opens this page, authored in `remotion/` as `McpStory`.
 * `steps` is the video's text alternative and must not drift from the captions
 * baked into the clip; bump the `?v=` whenever the MP4 is re-rendered.
 */
const MCP_CLIP = {
	src: "/mcp-access.mp4?v=3",
	poster: "/mcp-access-poster.webp?v=3",
	steps: [
		"Point your MCP host at Proyekto",
		"Grant only the access you approve",
		"Ask it, and it answers from your project",
		"Checked every call — revoke anytime",
	],
} as const;

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
	"ai-sessions:read": {
		label: "AI threads",
		hint: "Your own planning threads only",
		Icon: Sparkles,
	},
	"delivery:read": {
		label: "Delivery registers",
		hint: "Deliverables, change requests, risks, decisions",
		Icon: ClipboardList,
	},
	"roadmaps:write": {
		label: "Edit roadmaps",
		hint: "Preview & commit structural changes",
		Icon: Pencil,
	},
	"tasks:write": {
		label: "Create & edit tasks",
		hint: "Add tasks, update, comment",
		Icon: ListTodo,
	},
	"tasks:assign": {
		label: "Assign tasks",
		hint: "Set assignees (notifies members)",
		Icon: UserPlus,
	},
	"chat:write": {
		label: "Post to chat",
		hint: "Send, edit & delete channel messages",
		Icon: Send,
	},
	"delivery:write": {
		label: "Edit delivery registers",
		hint: "Create & update entries, run their lifecycles",
		Icon: ClipboardCheck,
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

function ScopeCard({
	scope,
	checked,
	onToggle,
}: {
	scope: McpScope;
	checked: boolean;
	onToggle: (scope: McpScope) => void;
}) {
	const { label, hint, Icon } = SCOPE_META[scope];
	return (
		<button
			type="button"
			aria-pressed={checked}
			onClick={() => onToggle(scope)}
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
				<span className="block text-xs text-muted-foreground">{hint}</span>
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
}

/**
 * Apps the user connected over OAuth (Claude on the web, desktop, or mobile).
 * Distinct from PATs: the user never sees a credential, so revoking here is the
 * only way to cut one off. Renders nothing at all until at least one exists, so
 * the page is unchanged for people who only use tokens.
 */
function ConnectedApps() {
	const toast = useToast();
	const qc = useQueryClient();

	const connectionsQuery = useQuery({
		queryKey: mcpConnectionKeys.all,
		queryFn: listMcpConnections,
		staleTime: 30 * 1000,
		retry: false,
	});

	const revokeMutation = useMutation({
		mutationFn: revokeMcpConnection,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: mcpConnectionKeys.all });
			toast.success("App disconnected");
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const connections = connectionsQuery.data ?? [];
	if (connections.length === 0) return null;

	return (
		<section className="mb-6 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-(--app-shadow-sm)">
			<div className="flex items-center justify-between border-b border-border px-5 py-5 sm:px-7">
				<div>
					<h2 className="text-base font-semibold">Connected apps</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Apps you signed in to. Disconnecting takes effect immediately.
					</p>
				</div>
				<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
					{connections.length} connected
				</span>
			</div>

			<ul className="divide-y divide-border">
				{connections.map((connection) => (
					<li
						key={connection.id}
						className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7"
					>
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<PlugZap className="h-4 w-4 shrink-0 text-muted-foreground" />
								<span className="truncate text-sm font-medium text-foreground">
									{connection.client_name ?? connection.client_id}
								</span>
							</div>
							<p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
								<span>Connected {formatDate(connection.created_at)}</span>
								<span>Last used {formatDate(connection.last_used_at)}</span>
							</p>
							<div className="mt-2 flex flex-wrap gap-1.5">
								{connection.scopes.map((scope) => (
									<span
										key={scope}
										className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
									>
										{scope}
									</span>
								))}
							</div>
						</div>
						<button
							type="button"
							onClick={() => revokeMutation.mutate(connection.id)}
							disabled={revokeMutation.isPending}
							className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive disabled:opacity-60 sm:self-auto"
						>
							<Trash2 className="h-3.5 w-3.5" />
							Disconnect
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}

/**
 * The one-time token reveal. Shared by the dialog (right after creation) and
 * the page banner (once the dialog is dismissed) so the secret is rendered by
 * one piece of markup rather than two that can drift apart.
 */
function IssuedTokenBody({
	token,
	copied,
	onCopy,
}: {
	token: string;
	copied: boolean;
	onCopy: () => void;
}) {
	return (
		<div className="min-w-0 flex-1">
			<h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
				<ShieldCheck className="h-5 w-5 text-primary" />
				Copy your new token now
			</h2>
			<p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
				<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
				This is the only time the full token is shown. Store it somewhere safe —
				you won’t be able to see it again.
			</p>
			<div className="mt-4 flex items-center gap-2">
				<code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-sm text-foreground">
					{token}
				</code>
				<button
					type="button"
					onClick={onCopy}
					className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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
	);
}

function McpTokensPage() {
	const toast = useToast();
	const qc = useQueryClient();
	const nameId = useId();
	const createTitleId = useId();

	const [createOpen, setCreateOpen] = useState(false);
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

	// Some scopes exist in the shared enum but are switched off server-side while
	// a capability is still dark. Offering them would mean a checkbox whose only
	// outcome is a 400, so the picker renders what the server says it can grant.
	const availableScopesQuery = useQuery({
		queryKey: mcpScopeKeys.all,
		queryFn: listAvailableMcpScopes,
		staleTime: 5 * 60 * 1000,
	});
	const availableScopes = availableScopesQuery.data;
	const readScopes = availableScopes
		? MCP_READ_SCOPES.filter((s) => availableScopes.includes(s))
		: MCP_READ_SCOPES;
	const writeScopes = availableScopes
		? MCP_WRITE_SCOPES.filter((s) => availableScopes.includes(s))
		: MCP_WRITE_SCOPES;

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

	// Escape closes the dialog in both states. Safe even right after a token is
	// issued: dismissing the dialog leaves the one-time reveal on the page, so
	// the only copy of the secret is never one stray keypress away from gone.
	useEffect(() => {
		if (!createOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setCreateOpen(false);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [createOpen]);

	/** Opens the dialog on a clean form - and clears any previous reveal. */
	const openCreate = () => {
		setIssued(null);
		setName("");
		setScopes([...MCP_READ_SCOPES]);
		setCopiedToken(false);
		setCreateOpen(true);
	};

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
		// The form seeds its selection from the static read set, so a scope that
		// is dark server-side could sit selected in state with no checkbox to
		// clear it. Send only what the server said it can grant.
		const grantable = scopes.filter(
			(s) => !availableScopes || availableScopes.includes(s),
		);
		if (grantable.length === 0) {
			toast.error("Select at least one scope.");
			return;
		}
		createMutation.mutate({ name: name.trim(), scopes: grantable });
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
		<>
			<div className="app-fade-in">
				{/* Header. The clip explains the same four ideas the prose does, so
				    they sit side by side rather than stacked - two full-width blocks
				    saying one thing cost most of the first screen. */}
				<div className="mb-8 grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
					<div className="flex items-start gap-4">
						<div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary sm:flex">
							<KeyRound className="h-6 w-6" />
						</div>
						<div>
							<h1 className="text-3xl font-semibold tracking-tight text-foreground">
								MCP Access
							</h1>
							<p className="mt-2 text-sm text-muted-foreground">
								Let MCP hosts work with your Proyekto data on your behalf. Apps
								like Claude connect through a sign-in prompt; command-line hosts
								such as Claude Code and Codex use a Personal Access Token.
								Either way, access is scoped to exactly what you approve,
								re-checked against your permissions on every call, and revocable
								at any time.
							</p>
						</div>
					</div>

					{/* The beats stay in `steps` for screen readers, but the visible
					    line is off: the prose beside it already says the same thing. */}
					<ExplainerVideo
						src={MCP_CLIP.src}
						poster={MCP_CLIP.poster}
						steps={MCP_CLIP.steps}
						stepsVisible={false}
						className="w-full max-w-[300px] lg:justify-self-end"
					/>
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

				{/* One-time reveal - the dialog owns this while it is open */}
				{issued && !createOpen && (
					<section className="app-slide-up mb-6 overflow-hidden rounded-2xl border border-primary/40 bg-primary/5 shadow-(--app-shadow-md)">
						<div className="flex items-start justify-between gap-4 px-5 py-5 sm:px-7">
							<IssuedTokenBody
								token={issued.token}
								copied={copiedToken}
								onCopy={() =>
									copy(
										issued.token,
										setCopiedToken,
										"Token copied to clipboard",
									)
								}
							/>
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

				{/* Apps connected over OAuth (Claude and friends) */}
				<ConnectedApps />

				{/* Existing tokens */}
				<section className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-(--app-shadow-sm)">
					<div className="flex items-center justify-between border-b border-border px-5 py-5 sm:px-7">
						<div>
							<h2 className="text-base font-semibold">Your tokens</h2>
							<p className="mt-1 text-sm text-muted-foreground">
								Revoke any you no longer use.
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-3">
							{tokens.length > 0 && (
								<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
									{activeCount} active
								</span>
							)}
							<button
								type="button"
								onClick={openCreate}
								className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-(--app-shadow-sm) transition-colors hover:bg-primary/90"
							>
								<Plus className="h-4 w-4" />
								Generate token
							</button>
						</div>
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
								Generate a token to connect a command-line MCP host to Proyekto.
							</p>
							<button
								type="button"
								onClick={openCreate}
								className="mt-1 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-(--app-shadow-sm) transition-colors hover:bg-primary/90"
							>
								<Plus className="h-4 w-4" />
								Generate your first token
							</button>
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

			{createOpen && (
				<ModalPortal>
					<div
						className="fixed inset-0 z-[10010] flex items-start justify-center overflow-y-auto bg-(--app-overlay) p-4 sm:items-center"
						role="presentation"
						onClick={() => setCreateOpen(false)}
					>
						<div
							role="dialog"
							aria-modal="true"
							aria-labelledby={createTitleId}
							onClick={(event) => event.stopPropagation()}
							className="my-auto w-full max-w-2xl rounded-2xl border border-border bg-popover text-popover-foreground shadow-(--app-shadow-lg)"
						>
							<div className="flex items-start justify-between gap-3 border-b border-border px-5 py-5 sm:px-7">
								<div>
									<h2 id={createTitleId} className="text-base font-semibold">
										{issued ? "Token created" : "Generate a new token"}
									</h2>
									<p className="mt-1 text-sm text-muted-foreground">
										{issued
											? "Copy it now, then close this dialog."
											: "Name it after where you’ll use it, and grant only the scopes that host needs."}
									</p>
								</div>
								<button
									type="button"
									onClick={() => setCreateOpen(false)}
									aria-label="Close"
									className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								>
									<X className="h-5 w-5" />
								</button>
							</div>

							{issued ? (
								<div className="px-5 py-6 sm:px-7">
									<IssuedTokenBody
										token={issued.token}
										copied={copiedToken}
										onCopy={() =>
											copy(
												issued.token,
												setCopiedToken,
												"Token copied to clipboard",
											)
										}
									/>
									<div className="mt-6 flex justify-end">
										<button
											type="button"
											onClick={() => setCreateOpen(false)}
											className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
										>
											Done
										</button>
									</div>
								</div>
							) : (
								<form onSubmit={handleCreate}>
									<div className="flex max-h-[65vh] flex-col gap-6 overflow-y-auto px-5 py-6 sm:px-7">
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
												autoFocus
												onChange={(e) => setName(e.target.value)}
												placeholder="e.g. My laptop — Claude Code"
												className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/50"
											/>
										</div>

										<fieldset>
											<legend className="text-sm font-medium text-foreground">
												Scopes
											</legend>

											<p className="mt-2 mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
												Read
											</p>
											<div className="grid gap-2.5 sm:grid-cols-2">
												{readScopes.map((scope) => (
													<ScopeCard
														key={scope}
														scope={scope}
														checked={scopes.includes(scope)}
														onToggle={toggleScope}
													/>
												))}
											</div>

											<div className="mt-4 mb-2 flex items-center gap-1.5">
												<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
													Write
												</p>
												<span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
													<AlertTriangle className="h-3 w-3" />
													lets a host modify your data
												</span>
											</div>
											<div className="grid gap-2.5 sm:grid-cols-2">
												{writeScopes.map((scope) => (
													<ScopeCard
														key={scope}
														scope={scope}
														checked={scopes.includes(scope)}
														onToggle={toggleScope}
													/>
												))}
											</div>
										</fieldset>
									</div>

									<div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-7">
										<span className="text-xs text-muted-foreground">
											{scopes.length} scope{scopes.length === 1 ? "" : "s"}{" "}
											selected
										</span>
										<div className="flex items-center gap-2">
											<button
												type="button"
												onClick={() => setCreateOpen(false)}
												className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
											>
												Cancel
											</button>
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
										</div>
									</div>
								</form>
							)}
						</div>
					</div>
				</ModalPortal>
			)}
		</>
	);
}
