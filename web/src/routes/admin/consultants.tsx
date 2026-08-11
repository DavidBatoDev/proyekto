import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertTriangle,
	BadgeCheck,
	Ban,
	Loader2,
	RotateCcw,
	Search,
	ShieldOff,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
	type AdminConsultantEnrollment,
	adminService,
	type ConsultantEnrollmentStatus,
} from "@/services/admin.service";

export const Route = createFileRoute("/admin/consultants")({
	component: ConsultantsAdminPage,
});

type LifecycleAction = "suspend" | "reinstate" | "revoke";

const STATUS_STYLES: Record<
	ConsultantEnrollmentStatus,
	{ label: string; className: string }
> = {
	pending: { label: "Pending", className: "bg-gray-100 text-gray-600" },
	verified: {
		label: "Verified",
		className: "bg-emerald-50 text-emerald-700 border border-emerald-200",
	},
	suspended: {
		label: "Suspended",
		className: "bg-amber-50 text-amber-700 border border-amber-200",
	},
	revoked: {
		label: "Revoked",
		className: "bg-red-50 text-red-700 border border-red-200",
	},
};

function displayName(enrollment: AdminConsultantEnrollment): string {
	const profile = enrollment.profile;
	if (!profile) return "Unknown consultant";
	return (
		profile.display_name ||
		[profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
		profile.email
	);
}

function StatusChip({ status }: { status: ConsultantEnrollmentStatus }) {
	const config = STATUS_STYLES[status];
	return (
		<span
			className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${config.className}`}
		>
			{config.label}
		</span>
	);
}

function ConsultantsAdminPage() {
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [status, setStatus] = useState<ConsultantEnrollmentStatus | "all">(
		"all",
	);
	const [selected, setSelected] = useState<AdminConsultantEnrollment | null>(
		null,
	);
	const [action, setAction] = useState<LifecycleAction | null>(null);
	const [reason, setReason] = useState("");

	const { data: consultants = [], isLoading } = useQuery({
		queryKey: ["adminConsultants"],
		queryFn: () => adminService.getConsultants(),
	});

	const transition = useMutation({
		mutationFn: async () => {
			if (!selected || !action) throw new Error("Choose an action.");
			const trimmedReason = reason.trim();
			if (action !== "reinstate" && !trimmedReason) {
				throw new Error("A reason is required.");
			}
			if (action === "suspend") {
				return adminService.suspendConsultant(selected.user_id, trimmedReason);
			}
			if (action === "reinstate") {
				return adminService.reinstateConsultant(
					selected.user_id,
					trimmedReason || undefined,
				);
			}
			return adminService.revokeConsultant(selected.user_id, trimmedReason);
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["adminConsultants"] });
			setSelected(null);
			setAction(null);
			setReason("");
		},
	});

	const filtered = useMemo(() => {
		const normalized = search.trim().toLowerCase();
		return consultants.filter((consultant) => {
			if (status !== "all" && consultant.status !== status) return false;
			if (!normalized) return true;
			return (
				displayName(consultant).toLowerCase().includes(normalized) ||
				consultant.profile?.email.toLowerCase().includes(normalized)
			);
		});
	}, [consultants, search, status]);

	const beginAction = (
		consultant: AdminConsultantEnrollment,
		nextAction: LifecycleAction,
	) => {
		setSelected(consultant);
		setAction(nextAction);
		setReason("");
		transition.reset();
	};

	return (
		<div className="h-full overflow-auto px-8 py-8">
			<div className="mb-6 flex items-end justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold text-gray-900">
						Consultant Access
					</h1>
					<p className="mt-1 text-sm text-gray-500">
						Manage verification without affecting active project access.
					</p>
				</div>
				<div className="flex gap-2">
					{(["all", "verified", "suspended", "revoked"] as const).map(
						(option) => (
							<button
								type="button"
								key={option}
								onClick={() => setStatus(option)}
								className={`rounded-lg px-3 py-2 text-sm font-medium capitalize ${
									status === option
										? "bg-amber-500 text-white"
										: "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
								}`}
							>
								{option}
							</button>
						),
					)}
				</div>
			</div>

			<div className="mb-4 max-w-sm relative">
				<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
				<input
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					placeholder="Search consultants..."
					className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-amber-400"
				/>
			</div>

			<div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
				{isLoading ? (
					<div className="flex justify-center py-20">
						<Loader2 className="h-7 w-7 animate-spin text-amber-500" />
					</div>
				) : filtered.length === 0 ? (
					<p className="py-20 text-center text-sm text-gray-500">
						No consultant enrollments match this filter.
					</p>
				) : (
					<table className="w-full">
						<thead className="border-b border-gray-200 bg-gray-50">
							<tr>
								{["Consultant", "Status", "Changed", "Reason", "Actions"].map(
									(label) => (
										<th
											key={label}
											className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
										>
											{label}
										</th>
									),
								)}
							</tr>
						</thead>
						<tbody>
							{filtered.map((consultant) => (
								<tr
									key={consultant.user_id}
									className="border-b border-gray-100 last:border-0"
								>
									<td className="px-5 py-4">
										<div className="flex items-center gap-3">
											<div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">
												{displayName(consultant).slice(0, 1).toUpperCase()}
											</div>
											<div>
												<p className="text-sm font-semibold text-gray-900">
													{displayName(consultant)}
												</p>
												<p className="text-xs text-gray-400">
													{consultant.profile?.email}
												</p>
											</div>
										</div>
									</td>
									<td className="px-5 py-4">
										<StatusChip status={consultant.status} />
									</td>
									<td className="px-5 py-4 text-sm text-gray-500">
										{new Date(consultant.updated_at).toLocaleDateString()}
									</td>
									<td className="max-w-xs truncate px-5 py-4 text-sm text-gray-500">
										{consultant.status_reason || "—"}
									</td>
									<td className="px-5 py-4">
										<div className="flex gap-2">
											{consultant.status === "verified" && (
												<button
													type="button"
													onClick={() => beginAction(consultant, "suspend")}
													className="inline-flex items-center gap-1 rounded-lg border border-amber-200 px-2.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50"
												>
													<Ban className="h-3.5 w-3.5" /> Suspend
												</button>
											)}
											{consultant.status === "suspended" && (
												<button
													type="button"
													onClick={() => beginAction(consultant, "reinstate")}
													className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
												>
													<RotateCcw className="h-3.5 w-3.5" /> Reinstate
												</button>
											)}
											{(consultant.status === "verified" ||
												consultant.status === "suspended") && (
												<button
													type="button"
													onClick={() => beginAction(consultant, "revoke")}
													className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
												>
													<ShieldOff className="h-3.5 w-3.5" /> Revoke
												</button>
											)}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			{selected && action && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
					<div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
						<div className="mb-4 flex items-start gap-3">
							<div className="rounded-full bg-amber-100 p-2 text-amber-700">
								{action === "reinstate" ? (
									<BadgeCheck className="h-5 w-5" />
								) : (
									<AlertTriangle className="h-5 w-5" />
								)}
							</div>
							<div>
								<h2 className="text-lg font-bold capitalize text-gray-900">
									{action} consultant
								</h2>
								<p className="text-sm text-gray-500">{displayName(selected)}</p>
							</div>
						</div>
						<label
							className="text-sm font-semibold text-gray-700"
							htmlFor="reason"
						>
							Reason {action === "reinstate" ? "(optional)" : ""}
						</label>
						<textarea
							id="reason"
							maxLength={1000}
							rows={4}
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							className="mt-2 w-full resize-none rounded-xl border border-gray-200 p-3 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-amber-400"
						/>
						{transition.error && (
							<p className="mt-2 text-sm text-red-600">
								{transition.error instanceof Error
									? transition.error.message
									: "Unable to update consultant status."}
							</p>
						)}
						<div className="mt-5 flex justify-end gap-2">
							<button
								type="button"
								onClick={() => {
									setSelected(null);
									setAction(null);
								}}
								className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => {
									if (
										action === "revoke" &&
										!window.confirm(
											`Revoke consultant access for ${displayName(selected)}? This remains in the audit history.`,
										)
									) {
										return;
									}
									transition.mutate();
								}}
								disabled={
									transition.isPending ||
									(action !== "reinstate" && !reason.trim())
								}
								className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50"
							>
								{transition.isPending && (
									<Loader2 className="h-4 w-4 animate-spin" />
								)}
								Confirm
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
