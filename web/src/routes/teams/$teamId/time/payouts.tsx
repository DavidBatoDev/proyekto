import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Ban, ExternalLink, Loader2, Wallet, X } from "lucide-react";
import { useState } from "react";
import { formatMoney } from "@/components/team-time/time-utils";
import { useToast } from "@/hooks/useToast";
import { type Payout, payoutsService } from "@/services/payouts.service";

export const Route = createFileRoute("/teams/$teamId/time/payouts")({
	component: PayoutsRoute,
});

const METHOD_LABEL: Record<string, string> = {
	bank: "Bank",
	gcash: "GCash",
	maya: "Maya",
	paypal: "PayPal",
	other: "Other",
};

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
});

function payoutMemberLabel(p: Payout): string {
	return (
		p.member?.display_name ||
		[p.member?.first_name, p.member?.last_name]
			.filter(Boolean)
			.join(" ")
			.trim() ||
		p.member?.email ||
		p.member_user_id
	);
}

function PayoutsRoute() {
	const { teamId } = Route.useParams();
	const [openId, setOpenId] = useState<string | null>(null);

	const payoutsQuery = useQuery({
		queryKey: ["payouts", teamId],
		queryFn: () => payoutsService.listTeamPayouts(teamId),
	});

	const payouts = payoutsQuery.data ?? [];

	if (payoutsQuery.isPending) {
		return (
			<div className="flex justify-center p-12">
				<Loader2 className="h-6 w-6 animate-spin text-slate-400" />
			</div>
		);
	}

	if (payouts.length === 0) {
		return (
			<div className="rounded-xl border border-slate-200 bg-white px-6 py-16">
				<div className="mx-auto flex max-w-sm flex-col items-center text-center">
					<div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
						<Wallet className="h-7 w-7 text-slate-500" />
					</div>
					<h3 className="text-base font-semibold text-slate-900">
						No payouts yet
					</h3>
					<p className="mt-2 text-sm text-slate-500">
						When you pay a member from the Team Logs tab, the record appears
						here with its method, reference, and proof.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-slate-200 bg-white">
			<table className="w-full text-xs">
				<thead className="bg-slate-900 text-white">
					<tr>
						<th className="px-3 py-2.5 text-left font-semibold">Member</th>
						<th className="px-3 py-2.5 text-left font-semibold">Date paid</th>
						<th className="px-3 py-2.5 text-right font-semibold">Amount</th>
						<th className="px-3 py-2.5 text-left font-semibold">Method</th>
						<th className="px-3 py-2.5 text-left font-semibold">Reference</th>
						<th className="px-3 py-2.5 text-left font-semibold">Status</th>
						<th className="w-10 px-3 py-2.5" />
					</tr>
				</thead>
				<tbody>
					{payouts.map((p) => (
						<tr
							key={p.id}
							onClick={() => setOpenId(p.id)}
							className="cursor-pointer border-t border-slate-200 hover:bg-slate-50"
						>
							<td className="px-3 py-2.5 font-medium text-slate-800">
								{payoutMemberLabel(p)}
							</td>
							<td className="px-3 py-2.5 text-slate-600">
								{DATE_FMT.format(new Date(p.paid_at))}
							</td>
							<td className="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-700">
								{formatMoney(p.total_amount, p.currency)}
							</td>
							<td className="px-3 py-2.5 text-slate-600">
								{p.method_type
									? `${METHOD_LABEL[p.method_type] ?? p.method_type}${p.method_label ? ` · ${p.method_label}` : ""}`
									: "—"}
							</td>
							<td className="px-3 py-2.5 text-slate-600">
								{p.reference_number || "—"}
							</td>
							<td className="px-3 py-2.5">
								<span
									className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
										p.status === "void"
											? "bg-slate-100 text-slate-500 line-through"
											: "bg-indigo-100 text-indigo-700"
									}`}
								>
									{p.status}
								</span>
							</td>
							<td className="px-3 py-2.5 text-right text-slate-400">
								<ExternalLink className="ml-auto h-3.5 w-3.5" />
							</td>
						</tr>
					))}
				</tbody>
			</table>

			{openId && (
				<PayoutDetailDrawer
					teamId={teamId}
					payoutId={openId}
					onClose={() => setOpenId(null)}
				/>
			)}
		</div>
	);
}

function PayoutDetailDrawer({
	teamId,
	payoutId,
	onClose,
}: {
	teamId: string;
	payoutId: string;
	onClose: () => void;
}) {
	const toast = useToast();
	const qc = useQueryClient();

	const detailQuery = useQuery({
		queryKey: ["payout", payoutId],
		queryFn: () => payoutsService.getPayout(payoutId),
	});

	const voidMutation = useMutation({
		mutationFn: () => payoutsService.voidPayout(payoutId),
		onSuccess: () => {
			toast.success("Payout voided. Its logs are back to approved.");
			qc.invalidateQueries({ queryKey: ["payouts", teamId] });
			qc.invalidateQueries({ queryKey: ["payout", payoutId] });
			qc.invalidateQueries({ queryKey: ["team-time", teamId] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const payout = detailQuery.data;

	return (
		<div
			className="fixed inset-0 z-160 flex justify-end bg-slate-900/40"
			onClick={onClose}
		>
			<div
				className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
					<h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
						<Wallet className="h-4 w-4 text-indigo-600" />
						Payout detail
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{detailQuery.isPending || !payout ? (
					<div className="flex flex-1 items-center justify-center">
						<Loader2 className="h-6 w-6 animate-spin text-slate-400" />
					</div>
				) : (
					<div className="flex-1 space-y-4 p-5">
						<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
							<div className="text-2xl font-bold text-emerald-700">
								{formatMoney(payout.total_amount, payout.currency)}
							</div>
							<div className="mt-1 text-xs text-slate-500">
								Paid to {payoutMemberLabel(payout)} on{" "}
								{DATE_FMT.format(new Date(payout.paid_at))}
							</div>
						</div>

						<dl className="space-y-2 text-xs">
							<Row label="Method">
								{payout.method_type
									? `${METHOD_LABEL[payout.method_type] ?? payout.method_type}${payout.method_label ? ` · ${payout.method_label}` : ""}`
									: "—"}
							</Row>
							<Row label="Account">
								{payout.method_account_name
									? `${payout.method_account_name}${payout.method_account_identifier ? ` · ${payout.method_account_identifier}` : ""}`
									: "—"}
							</Row>
							<Row label="Reference">{payout.reference_number || "—"}</Row>
							<Row label="Note">{payout.note || "—"}</Row>
							<Row label="Status">{payout.status}</Row>
						</dl>

						{payout.proof_path && (
							<ProofPreview
								payoutId={payout.id}
								proofPath={payout.proof_path}
							/>
						)}

						<div>
							<div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
								Logs in this payout ({payout.logs.length})
							</div>
							<div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
								{payout.logs.map((log) => (
									<div
										key={log.id}
										className="flex items-center justify-between px-3 py-2 text-xs"
									>
										<span className="truncate text-slate-700">
											{log.task?.title || log.project?.title || "Log"}
										</span>
										<span className="tabular-nums text-slate-500">
											{((log.duration_seconds ?? 0) / 3600).toFixed(2)}h
										</span>
									</div>
								))}
							</div>
						</div>

						{payout.status === "recorded" && (
							<button
								type="button"
								onClick={() => voidMutation.mutate()}
								disabled={voidMutation.isPending}
								className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
							>
								{voidMutation.isPending ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<Ban className="h-3.5 w-3.5" />
								)}
								Void payout
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

function ProofPreview({
	payoutId,
	proofPath,
}: {
	payoutId: string;
	proofPath: string;
}) {
	const isPdf = proofPath.toLowerCase().endsWith(".pdf");
	const urlQuery = useQuery({
		queryKey: ["payout-proof", payoutId],
		queryFn: () => payoutsService.getProofUrl(payoutId),
		staleTime: 4 * 60 * 1000, // presigned URLs are short-lived; refetch periodically
	});

	return (
		<div className="space-y-1.5">
			<div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
				Proof
			</div>
			{urlQuery.isPending ? (
				<div className="flex h-40 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
					<Loader2 className="h-5 w-5 animate-spin text-slate-400" />
				</div>
			) : urlQuery.isError || !urlQuery.data ? (
				<div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
					Couldn't load the proof file.
				</div>
			) : isPdf ? (
				<a
					href={urlQuery.data}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
				>
					<ExternalLink className="h-3.5 w-3.5" />
					Open PDF proof
				</a>
			) : (
				<a
					href={urlQuery.data}
					target="_blank"
					rel="noopener noreferrer"
					title="Open full size"
					className="group block overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
				>
					<img
						src={urlQuery.data}
						alt="Payment proof"
						className="max-h-72 w-full object-contain transition-opacity group-hover:opacity-90"
					/>
				</a>
			)}
		</div>
	);
}

function Row({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex justify-between gap-4">
			<dt className="text-slate-400">{label}</dt>
			<dd className="text-right font-medium text-slate-700">{children}</dd>
		</div>
	);
}
