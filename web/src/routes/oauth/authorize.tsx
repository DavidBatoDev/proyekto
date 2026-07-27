import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	AlertTriangle,
	BadgeCheck,
	Check,
	Eye,
	Loader2,
	Lock,
	Pencil,
	PlugZap,
	RefreshCw,
	ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { useToast } from "@/hooks/useToast";
import {
	approveConsent,
	type ConsentRequest,
	clientOrigin,
	denyConsent,
	getConsentRequest,
	isWriteScope,
	OFFLINE_ACCESS,
	scopeDescription,
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
	return (
		<button
			type="button"
			aria-pressed={checked}
			aria-label={scopeLabel(scope)}
			disabled={locked}
			onClick={() => !locked && onToggle(scope)}
			className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
				checked
					? "border-primary/40 bg-primary/5"
					: "border-border bg-background hover:border-primary/30 hover:bg-muted"
			} ${locked ? "cursor-default opacity-70" : ""}`}
		>
			<span
				className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
					checked
						? "border-primary bg-primary text-primary-foreground"
						: "border-border bg-background group-hover:border-primary/50"
				}`}
			>
				{checked && <Check className="h-3 w-3" strokeWidth={3} />}
			</span>

			<span className="min-w-0 flex-1">
				<span className="block text-sm font-medium leading-tight text-foreground">
					{scopeLabel(scope)}
				</span>
				<span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
					{scopeDescription(scope)}
				</span>
			</span>

			<code className="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
				{scope}
			</code>
		</button>
	);
}

function SectionHeader({
	icon: Icon,
	title,
	caution,
	action,
}: {
	icon: typeof Eye;
	title: string;
	caution?: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="mb-2 flex items-end justify-between gap-3">
			<div className="min-w-0">
				<span
					className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${
						caution
							? "text-amber-600 dark:text-amber-400"
							: "text-muted-foreground"
					}`}
				>
					<Icon className="h-3.5 w-3.5" />
					{title}
				</span>
				{caution && (
					<span className="mt-1 block text-xs text-muted-foreground">
						{caution}
					</span>
				)}
			</div>
			{action}
		</div>
	);
}

function AuthorizePage() {
	const { request_id: requestId } = Route.useSearch();
	const toast = useToast();
	const userEmail = useAuthStore((s) => s.user?.email);
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

	const request = consentQuery.data;
	const selected = useMemo(() => granted ?? [], [granted]);

	const { reads, writes, wantsOffline } = useMemo(() => {
		const requested = request?.requested_scopes ?? [];
		return {
			reads: requested.filter((s) => !isWriteScope(s) && s !== OFFLINE_ACCESS),
			writes: requested.filter(isWriteScope),
			wantsOffline: requested.includes(OFFLINE_ACCESS),
		};
	}, [request]);

	const toggle = (scope: string) =>
		setGranted((prev) =>
			(prev ?? []).includes(scope)
				? (prev ?? []).filter((s) => s !== scope)
				: [...(prev ?? []), scope],
		);

	const setGroup = (scopes: string[], on: boolean) =>
		setGranted((prev) => {
			const base = (prev ?? []).filter((s) => !scopes.includes(s));
			return on ? [...base, ...scopes] : base;
		});

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
				<div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					<span className="text-sm">Loading request…</span>
				</div>
			</ConsentShell>
		);
	}

	if (consentQuery.isError || !request) {
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

	const busy = approveMutation.isPending || denyMutation.isPending;
	const { host, verified } = clientOrigin(request);
	const grantedWrites = writes.filter((s) => selected.includes(s));
	const grantedReads = reads.filter((s) => selected.includes(s));
	const allReadsOn = reads.every((s) => selected.includes(s));
	const allWritesOn =
		writes.length > 0 && writes.every((s) => selected.includes(s));

	return (
		<ConsentShell>
			{/* Who is asking */}
			<div className="mb-5 flex items-start gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3.5">
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<PlugZap className="h-5 w-5" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-semibold text-foreground">
						{request.client_name}
					</p>
					{verified && host ? (
						<p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
							<BadgeCheck className="h-3.5 w-3.5 text-primary" />
							Identity published at{" "}
							<span className="font-medium text-foreground">{host}</span>
						</p>
					) : (
						<p className="mt-0.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
							<AlertTriangle className="h-3.5 w-3.5" />
							Self-registered — this name isn't verified
						</p>
					)}
				</div>
			</div>

			<p className="text-sm text-muted-foreground">
				Choose what it may do on your behalf. It only ever sees projects you
				already have access to, and every action is re-checked against your
				permissions.
			</p>

			{userEmail && (
				<p className="mt-2 text-xs text-muted-foreground">
					Authorizing as{" "}
					<span className="font-medium text-foreground">{userEmail}</span>
				</p>
			)}

			{/* Read */}
			{reads.length > 0 && (
				<section className="mt-5">
					<SectionHeader
						icon={Eye}
						title="Read access"
						action={
							<button
								type="button"
								disabled={busy}
								onClick={() => setGroup(reads, !allReadsOn)}
								className="shrink-0 text-xs font-medium text-primary transition-opacity hover:opacity-80 disabled:opacity-50"
							>
								{allReadsOn ? "Clear all" : "Select all"}
							</button>
						}
					/>
					<div className="space-y-1.5">
						{reads.map((scope) => (
							<ScopeRow
								key={scope}
								scope={scope}
								checked={selected.includes(scope)}
								locked={busy}
								onToggle={toggle}
							/>
						))}
					</div>
				</section>
			)}

			{/* Write — visually separated, because this is the consequential half */}
			{writes.length > 0 && (
				<section className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
					<SectionHeader
						icon={Pencil}
						title="Can change your data"
						caution="Off by default. Only grant what this app actually needs."
						action={
							<button
								type="button"
								disabled={busy}
								onClick={() => setGroup(writes, !allWritesOn)}
								className="shrink-0 text-xs font-medium text-amber-700 transition-opacity hover:opacity-80 disabled:opacity-50 dark:text-amber-400"
							>
								{allWritesOn ? "Clear all" : "Select all"}
							</button>
						}
					/>
					<div className="space-y-1.5">
						{writes.map((scope) => (
							<ScopeRow
								key={scope}
								scope={scope}
								checked={selected.includes(scope)}
								locked={busy}
								onToggle={toggle}
							/>
						))}
					</div>
				</section>
			)}

			{/* offline_access is not a data permission — keep it out of both lists */}
			{wantsOffline && (
				<section className="mt-5">
					<SectionHeader icon={RefreshCw} title="Session" />
					<ScopeRow
						scope={OFFLINE_ACCESS}
						checked={selected.includes(OFFLINE_ACCESS)}
						locked={busy}
						onToggle={toggle}
					/>
				</section>
			)}

			<p className="mt-5 flex items-start gap-2 text-xs text-muted-foreground">
				<Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
				<span>
					You can disconnect this app at any time from{" "}
					<span className="font-medium text-foreground">
						Settings → MCP access
					</span>
					.
				</span>
			</p>

			{/* Deliberately NOT sticky: a pinned bar sits on top of the last scope
			    row and the disconnect note on a short viewport, and hiding part of
			    what you are consenting to is the one thing this screen must not do. */}
			<div className="-mx-6 mt-5 border-t border-border px-6 pt-4 sm:-mx-8 sm:px-8">
				<div className="mb-3 text-xs">
					{selected.length === 0 ? (
						<span className="text-muted-foreground">
							Select at least one permission to continue.
						</span>
					) : grantedWrites.length > 0 ? (
						<span className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
							<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span>
								Granting {grantedReads.length} read and{" "}
								<span className="font-semibold">
									{grantedWrites.length} change
								</span>{" "}
								{grantedWrites.length === 1 ? "permission" : "permissions"} —
								this app will be able to modify your data.
							</span>
						</span>
					) : (
						<span className="text-muted-foreground">
							Granting {grantedReads.length} read-only{" "}
							{grantedReads.length === 1 ? "permission" : "permissions"}. This
							app cannot change anything.
						</span>
					)}
				</div>

				<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
			</div>
		</ConsentShell>
	);
}

function ConsentShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8">
			<div className="w-full max-w-xl rounded-2xl border border-border bg-card px-6 py-6 shadow-sm sm:px-8 sm:py-7">
				<div className="mb-5 flex items-center gap-2">
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
		<div className="flex flex-col items-center gap-3 py-10 text-center">
			<span className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
				<AlertTriangle className="h-5 w-5" />
			</span>
			<p className="max-w-sm text-sm text-muted-foreground">{message}</p>
		</div>
	);
}
