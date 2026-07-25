import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	AlertTriangle,
	Check,
	Loader2,
	Lock,
	PlugZap,
	ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { useToast } from "@/hooks/useToast";
import {
	approveConsent,
	type ConsentRequest,
	denyConsent,
	getConsentRequest,
	isWriteScope,
	OFFLINE_ACCESS,
	scopeLabel,
} from "@/services/mcp-oauth.service";
import { useAuthStore } from "@/stores/authStore";

/**
 * OAuth consent screen for the Proyekto MCP server.
 *
 * An MCP host (Claude, or any OAuth client) sends the browser to the backend's
 * /oauth/authorize, which validates the request and bounces here with a
 * request_id. We render what the app is asking for, the user approves or
 * declines, and the backend hands back the URL to return to.
 *
 * Deliberately NOT registered in Header.tsx validPaths: an unrecognized path
 * renders no header, which is exactly what this standalone screen wants. Do not
 * "fix" that by adding /oauth to the list.
 */
export const Route = createFileRoute("/oauth/authorize")({
	validateSearch: (
		search: Record<string, unknown>,
	): { request_id?: string } => {
		const id = search.request_id;
		return typeof id === "string" && id.length > 0 ? { request_id: id } : {};
	},
	beforeLoad: () => {
		if (!useAuthStore.getState().isAuthenticated) {
			// Carry the whole query string through login, otherwise request_id is
			// lost and the host's authorization request dies here.
			throw redirect({
				to: "/auth/login",
				search: {
					redirect: `/oauth/authorize${window.location.search}`,
				},
			});
		}
	},
	component: AuthorizePage,
});

function ScopeRow({
	scope,
	checked,
	locked,
	onToggle,
}: {
	scope: string;
	checked: boolean;
	locked: boolean;
	onToggle: (scope: string) => void;
}) {
	const write = isWriteScope(scope);
	return (
		<button
			type="button"
			aria-pressed={checked}
			disabled={locked}
			onClick={() => !locked && onToggle(scope)}
			className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-all ${
				checked
					? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
					: "border-border bg-background hover:border-primary/40 hover:bg-muted"
			} ${locked ? "cursor-default opacity-80" : ""}`}
		>
			<span className="min-w-0 flex-1">
				<span className="flex items-center gap-2 text-sm font-medium text-foreground">
					{scopeLabel(scope)}
					{write && (
						<span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
							<AlertTriangle className="h-3 w-3" />
							Can change data
						</span>
					)}
				</span>
				<span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
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

function AuthorizePage() {
	const { request_id: requestId } = Route.useSearch();
	const toast = useToast();
	const [granted, setGranted] = useState<string[] | null>(null);

	const consentQuery = useQuery<ConsentRequest>({
		queryKey: ["mcp-oauth-consent", requestId],
		queryFn: () => getConsentRequest(requestId as string),
		enabled: !!requestId,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
	});

	// Least privilege by default: read scopes pre-checked, write scopes opt-in.
	// offline_access is pre-checked because unchecking it just makes the host
	// re-prompt, which reads as a bug rather than as a safety win.
	useEffect(() => {
		const req = consentQuery.data;
		if (!req || granted !== null) return;
		setGranted(req.requested_scopes.filter((s) => !isWriteScope(s)));
	}, [consentQuery.data, granted]);

	const approveMutation = useMutation({
		mutationFn: approveConsent,
		onSuccess: (redirectTo) => {
			window.location.href = redirectTo;
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const denyMutation = useMutation({
		mutationFn: denyConsent,
		onSuccess: (redirectTo) => {
			window.location.href = redirectTo;
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const toggle = (scope: string) =>
		setGranted((prev) =>
			(prev ?? []).includes(scope)
				? (prev ?? []).filter((s) => s !== scope)
				: [...(prev ?? []), scope],
		);

	if (!requestId) {
		return (
			<ConsentShell>
				<ErrorState message="This link is missing its authorization request. Start again from the app you're connecting." />
			</ConsentShell>
		);
	}

	if (consentQuery.isLoading) {
		return (
			<ConsentShell>
				<div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					<span className="text-sm">Loading request…</span>
				</div>
			</ConsentShell>
		);
	}

	if (consentQuery.isError || !consentQuery.data) {
		return (
			<ConsentShell>
				<ErrorState
					message={
						consentQuery.error instanceof Error
							? consentQuery.error.message
							: "This authorization request has expired. Start again from the app you're connecting."
					}
				/>
			</ConsentShell>
		);
	}

	const request = consentQuery.data;
	const selected = granted ?? [];
	const dataScopes = request.requested_scopes.filter(
		(s) => s !== OFFLINE_ACCESS,
	);
	const wantsOffline = request.requested_scopes.includes(OFFLINE_ACCESS);
	const busy = approveMutation.isPending || denyMutation.isPending;

	return (
		<ConsentShell>
			<div className="mb-6 flex items-start gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<PlugZap className="h-5 w-5" />
				</span>
				<div className="min-w-0">
					<p className="text-sm font-semibold text-foreground">
						{request.client_name}
					</p>
					<p className="truncate font-mono text-[11px] text-muted-foreground">
						{request.client_id}
					</p>
				</div>
			</div>

			<p className="mb-3 text-sm text-muted-foreground">
				Choose what this app may do on your behalf. It will only ever see
				projects you already have access to, and every action is re-checked
				against your permissions.
			</p>

			<div className="space-y-2">
				{dataScopes.map((scope) => (
					<ScopeRow
						key={scope}
						scope={scope}
						checked={selected.includes(scope)}
						locked={busy}
						onToggle={toggle}
					/>
				))}
			</div>

			{wantsOffline && (
				<div className="mt-4">
					<ScopeRow
						scope={OFFLINE_ACCESS}
						checked={selected.includes(OFFLINE_ACCESS)}
						locked={busy}
						onToggle={toggle}
					/>
				</div>
			)}

			<div className="mt-6 flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-xs text-muted-foreground">
				<Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
				<span>
					You can disconnect this app at any time from{" "}
					<span className="font-medium text-foreground">
						Settings → MCP access
					</span>
					.
				</span>
			</div>

			<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<button
					type="button"
					disabled={busy}
					onClick={() => denyMutation.mutate(requestId)}
					className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
				>
					Cancel
				</button>
				<button
					type="button"
					disabled={busy || selected.length === 0}
					onClick={() =>
						approveMutation.mutate({
							request_id: requestId,
							granted_scopes: selected,
						})
					}
					className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
				>
					{approveMutation.isPending && (
						<Loader2 className="h-4 w-4 animate-spin" />
					)}
					Allow access
				</button>
			</div>
			{selected.length === 0 && (
				<p className="mt-2 text-right text-xs text-muted-foreground">
					Select at least one permission to continue.
				</p>
			)}
		</ConsentShell>
	);
}

function ConsentShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
			<div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
				<div className="mb-6 flex items-center gap-2">
					<BrandMark className="h-6 text-foreground" />
					<span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
						<ShieldCheck className="h-3.5 w-3.5" />
						Authorize access
					</span>
				</div>
				{children}
			</div>
		</div>
	);
}

function ErrorState({ message }: { message: string }) {
	return (
		<div className="flex flex-col items-center gap-3 py-8 text-center">
			<span className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
				<AlertTriangle className="h-5 w-5" />
			</span>
			<p className="max-w-sm text-sm text-muted-foreground">{message}</p>
		</div>
	);
}
