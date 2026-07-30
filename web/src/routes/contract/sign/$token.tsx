import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	CheckCircle2,
	FileSignature,
	Loader2,
	ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { ContractDocumentPreview } from "@/components/project/ContractDocumentPreview";
import { SignaturePad } from "@/components/project/signature/SignaturePad";
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
export const Route = createFileRoute("/contract/sign/$token")({
	// No beforeLoad auth guard: the token IS the authorization.
	component: PublicSignPage,
});

function PublicSignPage() {
	const { token } = Route.useParams();
	const [signed, setSigned] = useState<ContractDocumentView | null>(null);
	const [name, setName] = useState("");

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

	return (
		<Shell>
			<div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
				{/* The agreement */}
				<div>
					<ContractDocumentPreview
						contract={contract}
						parties={{
							provider_name: contract.provider_name ?? "",
							provider_address: contract.provider_address ?? "",
							provider_email: contract.provider_email,
							client_name: contract.client_name ?? "",
							client_contact_name: contract.client_contact_name ?? "",
							client_address: contract.client_address ?? "",
						}}
						terms={{
							currency: contract.currency,
							billing_mode: contract.billing_mode,
							recurring_fee: contract.recurring_fee?.toString() ?? "",
							client_hourly_rate: contract.client_hourly_rate?.toString() ?? "",
							service_description: contract.service_description ?? "",
							payment_method: contract.payment_method ?? "",
							due_days: String(contract.due_days),
							billing_timing: contract.billing_timing,
							auto_renew: contract.auto_renew,
							notice_days: String(contract.notice_days ?? ""),
						}}
					/>
				</div>

				{/* Sign / thank-you */}
				<div className="lg:sticky lg:top-6 lg:self-start">
					<div className="rounded-2xl border border-border bg-card p-6">
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
									onSign={(signaturePng) =>
										signMutation.mutate(signaturePng ?? undefined)
									}
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
