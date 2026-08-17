import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	CheckCircle2,
	FileSignature,
	Loader2,
	Maximize2,
	Minus,
	Plus,
	ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import {
	type ContractCanvasStats,
	ContractEditorCanvas,
} from "@/components/finance/ContractEditorCanvas";
import { SignaturePad } from "@/components/project/signature/SignaturePad";
import { useConfirm } from "@/hooks/useConfirm";
import { formatContractDate } from "@/lib/contract-term";
import {
	type ContractDocumentView,
	contractSigningService,
	SigningLinkError,
} from "@/services/contract-signing.service";

/**
 * Remote contract signing — no account, no session.
 *
 * The path is SINGULAR (`/contract/sign/...`) on purpose: `layout/Header.tsx`
 * prefix-matches `/project` and `/contracts` to decide whether to render the
 * app chrome, so the singular form keeps this page bare, the same way
 * `/roadmap/shared/$token` does.
 */
export const Route = createFileRoute("/_marketplace/contract/sign/$token")({
	// No beforeLoad auth guard: the token IS the authorization.
	component: PublicSignPage,
});

function PublicSignPage() {
	const { token } = Route.useParams();
	const [signed, setSigned] = useState<ContractDocumentView | null>(null);
	const [name, setName] = useState("");
	const confirm = useConfirm();
	const [zoom, setZoom] = useState(80);
	const [fitSignal, setFitSignal] = useState(0);
	const [canvasStats, setCanvasStats] = useState<ContractCanvasStats>({
		currentPage: 1,
		pageCount: 1,
		wordCount: 0,
	});

	const contractQuery = useQuery({
		queryKey: ["public-contract", token],
		queryFn: () => contractSigningService.getByToken(token),
		retry: false,
		staleTime: 0,
		gcTime: 0,
	});

	const signMutation = useMutation({
		mutationFn: (signaturePng?: string) =>
			contractSigningService.sign(token, {
				signer_name: name.trim(),
				...(signaturePng ? { signature_png: signaturePng } : {}),
			}),
		onSuccess: (result) => setSigned(result),
	});

	if (contractQuery.isPending) {
		return (
			<Shell>
				<div className="flex items-center justify-center py-20">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			</Shell>
		);
	}

	if (contractQuery.error) {
		const problem =
			contractQuery.error instanceof SigningLinkError
				? contractQuery.error.problem
				: { kind: "error" as const, message: "Something went wrong." };
		return (
			<Shell>
				<div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center">
					<ShieldAlert className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
					<h1 className="text-base font-semibold text-card-foreground">
						{problem.kind === "gone"
							? "This link is no longer active"
							: "This link isn't valid"}
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						{problem.message}
					</p>
					<p className="mt-4 text-xs text-muted-foreground">
						Ask whoever sent it to issue a new one.
					</p>
				</div>
			</Shell>
		);
	}

	const contract = signed ?? contractQuery.data;
	if (!contract) return null;
	const done = Boolean(signed);
	const submitSignature = async (signaturePng?: string | null) => {
		const confirmed = await confirm({
			title: "Sign this agreement?",
			message: (
				<>
					You are signing this agreement as <strong>{name.trim()}</strong>. Your
					signature is recorded and this one-time link will no longer be usable.
				</>
			),
			confirmLabel: "Sign agreement",
		});
		if (confirmed) signMutation.mutate(signaturePng ?? undefined);
	};

	return (
		<Shell>
			<div className="grid min-h-[calc(100dvh-4rem)] w-full grid-cols-1 overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(0,7fr)_minmax(20rem,3fr)]">
				{/* The agreement */}
				<div className="flex min-h-[68dvh] min-w-0 flex-col lg:min-h-0">
					<div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3">
						<div className="flex min-w-0 items-center gap-2">
							<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<FileSignature className="h-4 w-4" />
							</span>
							<div className="min-w-0">
								<h1 className="truncate text-sm font-semibold text-foreground">
									Service agreement
								</h1>
								<p className="truncate text-[11px] text-muted-foreground">
									Review before signing
								</p>
							</div>
						</div>
						<div className="flex items-center gap-1 rounded-md border border-border p-0.5">
							<button
								type="button"
								onClick={() => setZoom((value) => Math.max(30, value - 10))}
								className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
								aria-label="Zoom out"
							>
								<Minus className="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								onClick={() => setFitSignal((value) => value + 1)}
								className="w-11 rounded py-1 text-center text-[11px] tabular-nums text-foreground hover:bg-muted"
								aria-label="Fit document to canvas"
							>
								{zoom}%
							</button>
							<button
								type="button"
								onClick={() => setZoom((value) => Math.min(200, value + 10))}
								className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
								aria-label="Zoom in"
							>
								<Plus className="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								onClick={() => setFitSignal((value) => value + 1)}
								className="hidden rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-flex"
								aria-label="Fit document"
							>
								<Maximize2 className="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
					<div className="min-h-0 flex-1">
						<ContractEditorCanvas
							contract={contract}
							parties={{
								provider_name: contract.provider_name ?? "",
								provider_address: contract.provider_address ?? "",
								provider_email: contract.provider_email,
								provider_tin: contract.provider_tin,
								provider_kind: contract.provider_kind,
								client_name: contract.client_name ?? "",
								client_contact_name: contract.client_contact_name ?? "",
								client_address: contract.client_address ?? "",
								client_email: contract.client_email,
								client_tin: contract.client_tin,
							}}
							terms={{
								currency: contract.currency,
								billing_mode: contract.billing_mode,
								fixed_fee: contract.fixed_fee?.toString() ?? "",
								recurring_fee: contract.recurring_fee?.toString() ?? "",
								client_hourly_rate:
									contract.client_hourly_rate?.toString() ?? "",
								service_description: contract.service_description ?? "",
								payment_method: contract.payment_method ?? "",
								due_days: String(contract.due_days),
								billing_timing: contract.billing_timing,
								auto_renew: contract.auto_renew,
								notice_days: String(contract.notice_days ?? ""),
							}}
							editable={false}
							selectable={false}
							zoom={zoom}
							onZoomChange={setZoom}
							fitSignal={fitSignal}
							onStatsChange={setCanvasStats}
						/>
					</div>
					<footer className="flex h-9 shrink-0 items-center justify-between border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
						<span>
							Page {canvasStats.currentPage} of {canvasStats.pageCount}
						</span>
						<span>
							{canvasStats.wordCount}{" "}
							{canvasStats.wordCount === 1 ? "word" : "words"}
						</span>
					</footer>
				</div>

				{/* Sign / thank-you */}
				<div className="border-t border-border bg-background lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
					<div className="p-5 lg:p-6">
						{done ? (
							<>
								<CheckCircle2 className="mb-3 h-8 w-8 text-emerald-500" />
								<h2 className="text-base font-semibold text-card-foreground">
									Signed — thank you
								</h2>
								<p className="mt-1.5 text-sm text-muted-foreground">
									{contract.signed_by_client_name} signed on{" "}
									{contract.signed_by_client_at
										? formatContractDate(
												contract.signed_by_client_at.slice(0, 10),
											)
										: "today"}
									. A copy stays with{" "}
									{contract.provider_name || "your service provider"}.
								</p>
								<p className="mt-4 text-xs text-muted-foreground">
									This link has now been used and won't open again.
								</p>
								<Link
									to="/auth/signup"
									className="mt-4 inline-flex text-xs font-semibold text-primary hover:underline"
								>
									Create a Proyekto account to follow this project
								</Link>
							</>
						) : (
							<>
								<FileSignature className="mb-3 h-8 w-8 text-primary" />
								<h2 className="text-base font-semibold text-card-foreground">
									Sign this agreement
								</h2>
								<p className="mt-1.5 text-sm text-muted-foreground">
									Type your full name to sign. Drawing your signature is
									optional — the typed name is what makes it binding.
								</p>

								{!contract.signed_by_consultant_at && (
									<p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
										{contract.provider_name || "The service provider"} hasn't
										countersigned yet. The agreement takes effect once both
										parties have signed.
									</p>
								)}

								<SignaturePad
									name={name}
									onNameChange={setName}
									deliver="data-url"
									onSign={(signaturePng) => void submitSignature(signaturePng)}
									isPending={signMutation.isPending}
								/>

								{signMutation.error && (
									<p className="mt-3 text-xs text-destructive">
										{(signMutation.error as Error).message}
									</p>
								)}

								<p className="mt-4 text-[11px] text-muted-foreground">
									This link works once and expires on{" "}
									{formatContractDate(contract.expires_at.slice(0, 10))}.
								</p>
							</>
						)}
					</div>
				</div>
			</div>
		</Shell>
	);
}

function Shell({ children }: { children: React.ReactNode }) {
	return (
		<div className="app-shell-bg min-h-screen w-full overflow-y-auto">
			<div className="mx-auto w-full max-w-6xl px-5 py-8 md:px-8 md:py-12">
				{children}
			</div>
		</div>
	);
}
