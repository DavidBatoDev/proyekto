import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit2, Loader2, Plus, Star, Trash2, Wallet } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/useToast";
import {
	type CreatePayoutMethodInput,
	type PayoutMethod,
	payoutsService,
} from "@/services/payouts.service";
import { PayoutMethodModal } from "./PayoutMethodModal";

const METHOD_LABEL: Record<string, string> = {
	bank: "Bank",
	gcash: "GCash",
	maya: "Maya",
	paypal: "PayPal",
	other: "Other",
};

function maskIdentifier(value: string): string {
	if (value.length <= 4) return `••${value.slice(-2)}`;
	return `••••${value.slice(-4)}`;
}

/**
 * Self-contained "Payout methods" card for the profile page (own profile
 * only). Manages its own query/mutations/modal so it can drop into the
 * profile route without touching its many other handlers.
 */
export function PayoutMethodsSection() {
	const toast = useToast();
	const qc = useQueryClient();
	const [modalOpen, setModalOpen] = useState(false);
	const [editing, setEditing] = useState<PayoutMethod | null>(null);

	const methodsQuery = useQuery({
		queryKey: ["payout-methods", "mine"],
		queryFn: () => payoutsService.listMyMethods(),
	});

	const invalidate = () =>
		qc.invalidateQueries({ queryKey: ["payout-methods", "mine"] });

	const saveMutation = useMutation({
		mutationFn: (input: CreatePayoutMethodInput) =>
			editing
				? payoutsService.updateMethod(editing.id, input)
				: payoutsService.createMethod(input),
		onSuccess: () => {
			toast.success(
				editing ? "Payout method updated." : "Payout method added.",
			);
			setModalOpen(false);
			setEditing(null);
			invalidate();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const deleteMutation = useMutation({
		mutationFn: (id: string) => payoutsService.deleteMethod(id),
		onSuccess: () => {
			toast.success("Payout method removed.");
			invalidate();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const defaultMutation = useMutation({
		mutationFn: (id: string) => payoutsService.setDefaultMethod(id),
		onSuccess: () => invalidate(),
		onError: (e: Error) => toast.error(e.message),
	});

	const methods = methodsQuery.data ?? [];

	return (
		<div className="rounded-2xl border border-gray-200 bg-white p-6">
			<div className="mb-4 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Wallet className="h-5 w-5 text-gray-900" strokeWidth={2.5} />
					<h2 className="text-lg font-bold text-gray-900">Payout methods</h2>
				</div>
				<button
					onClick={() => {
						setEditing(null);
						setModalOpen(true);
					}}
					className="rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-100"
					title="Add payout method"
				>
					<Plus className="h-4 w-4" strokeWidth={2.5} />
				</button>
			</div>

			<p className="mb-4 text-xs text-gray-500">
				Where teams pay you. Only you and a team owner paying you can see these
				details.
			</p>

			{methodsQuery.isPending ? (
				<div className="flex items-center gap-2 py-4 text-sm text-gray-400">
					<Loader2 className="h-4 w-4 animate-spin" /> Loading…
				</div>
			) : methods.length === 0 ? (
				<p className="py-2 text-sm italic text-gray-400">
					No payout methods yet. Add a bank account or e-wallet.
				</p>
			) : (
				<div className="space-y-2">
					{methods.map((m) => (
						<div
							key={m.id}
							className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-2.5"
						>
							{m.qr_url && (
								<img
									src={m.qr_url}
									alt="Payout QR"
									title="Scan-to-pay QR"
									className="h-11 w-11 shrink-0 rounded-lg border border-gray-200 bg-white object-contain p-0.5"
								/>
							)}
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="text-sm font-semibold text-gray-900">
										{METHOD_LABEL[m.method_type] ?? m.method_type}
										{m.label ? ` · ${m.label}` : ""}
									</span>
									{m.is_default && (
										<span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
											<Star className="h-2.5 w-2.5" /> Default
										</span>
									)}
								</div>
								<div className="truncate text-xs text-gray-500">
									{m.account_name}
									{m.bank_name ? ` · ${m.bank_name}` : ""} ·{" "}
									{maskIdentifier(m.account_identifier)}
									{m.currency ? ` · ${m.currency}` : ""}
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-1">
								{!m.is_default && (
									<button
										onClick={() => defaultMutation.mutate(m.id)}
										disabled={defaultMutation.isPending}
										title="Set as default"
										className="rounded-lg p-1.5 text-gray-400 hover:text-indigo-600"
									>
										<Star className="h-3.5 w-3.5" />
									</button>
								)}
								<button
									onClick={() => {
										setEditing(m);
										setModalOpen(true);
									}}
									title="Edit"
									className="rounded-lg p-1.5 text-gray-400 hover:text-[#ff9933]"
								>
									<Edit2 className="h-3.5 w-3.5" />
								</button>
								<button
									onClick={() => deleteMutation.mutate(m.id)}
									disabled={deleteMutation.isPending}
									title="Remove"
									className="rounded-lg p-1.5 text-gray-400 hover:text-red-500"
								>
									{deleteMutation.isPending ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										<Trash2 className="h-3.5 w-3.5" />
									)}
								</button>
							</div>
						</div>
					))}
				</div>
			)}

			<PayoutMethodModal
				isOpen={modalOpen}
				initial={editing}
				onClose={() => {
					setModalOpen(false);
					setEditing(null);
				}}
				onSave={(input) => saveMutation.mutate(input)}
				isSaving={saveMutation.isPending}
			/>
		</div>
	);
}
