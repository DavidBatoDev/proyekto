import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useToast } from "@/hooks/useToast";
import {
	createMemberRate,
	deleteMemberRate,
	getActiveMemberRate,
	listMemberRates,
	listTeamMembers,
	updateMemberRate,
	type TeamMember,
	type TeamMemberRate,
} from "@/services/teams.service";
import { TeamRatesSection } from "@/components/team-time/TeamRatesSection";
import { TeamMemberRateHistoryDrawer } from "@/components/team-time/TeamMemberRateHistoryDrawer";
import {
	AddRateModal,
	DeleteRateModal,
	EditRateModal,
} from "@/components/team-time/TeamTimeModals";

export const Route = createFileRoute("/teams/$teamId/time/manage-rates/")({
	component: ManageRatesTab,
});

function memberDisplayLabel(m: TeamMember | null): string {
	if (!m) return "";
	const composed = [m.user?.first_name, m.user?.last_name]
		.filter(Boolean)
		.join(" ")
		.trim();
	return m.user?.display_name || composed || m.user?.email || m.user_id;
}

function ManageRatesTab() {
	const { teamId } = Route.useParams();
	const toast = useToast();
	const qc = useQueryClient();
	const navigate = useNavigate();

	// ─── data ─────────────────────────────────────────────────────────

	const membersQuery = useQuery({
		queryKey: ["team", teamId, "members"],
		queryFn: () => listTeamMembers(teamId),
	});
	const allMembers = membersQuery.data ?? [];

	// One active-rate query per member. Useful even for the rates card
	// (decides which members appear) and the modal (decides which can be
	// added). Keys are kept narrow so individual rate mutations only
	// invalidate their own slot.
	const activeRatesQueries = useQueries({
		queries: allMembers.map((m) => ({
			queryKey: ["team", teamId, "rates", "active", m.user_id] as const,
			queryFn: () => getActiveMemberRate(teamId, m.user_id),
			staleTime: 5_000,
		})),
	});
	const activeRateByUserId: Record<string, TeamMemberRate | null | undefined> =
		useMemo(() => {
			const map: Record<string, TeamMemberRate | null | undefined> = {};
			allMembers.forEach((m, idx) => {
				map[m.user_id] = activeRatesQueries[idx]?.data ?? null;
			});
			return map;
		}, [allMembers, activeRatesQueries]);
	const loadingRates = activeRatesQueries.some((q) => q.isPending);

	const membersWithoutActiveRate = useMemo(
		() => allMembers.filter((m) => !activeRateByUserId[m.user_id]),
		[allMembers, activeRateByUserId],
	);

	// ─── history drawer state ────────────────────────────────────────

	const [historyMember, setHistoryMember] = useState<TeamMember | null>(null);
	const historyOpen = historyMember !== null;
	const historyQuery = useQuery({
		queryKey: ["team", teamId, "rates", "history", historyMember?.user_id],
		queryFn: () => listMemberRates(teamId, historyMember!.user_id),
		enabled: historyOpen,
	});

	// ─── Add Rate state ──────────────────────────────────────────────

	const [addOpen, setAddOpen] = useState(false);
	const [addUserId, setAddUserId] = useState("");
	const [addCustomId, setAddCustomId] = useState("");
	const [addValue, setAddValue] = useState("");
	const [addCurrency, setAddCurrency] = useState("USD");
	const [addStartDate, setAddStartDate] = useState("");
	const [addEndDate, setAddEndDate] = useState("");

	// ─── Edit Rate state ─────────────────────────────────────────────

	const [editing, setEditing] = useState<TeamMemberRate | null>(null);
	const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
	const [editCustomId, setEditCustomId] = useState("");
	const [editValue, setEditValue] = useState("");
	const [editCurrency, setEditCurrency] = useState("USD");
	const [editStartDate, setEditStartDate] = useState("");
	const [editEndDate, setEditEndDate] = useState("");

	// ─── Delete Rate state ───────────────────────────────────────────

	const [deletingRate, setDeletingRate] = useState<TeamMemberRate | null>(null);
	const [deletingMember, setDeletingMember] = useState<TeamMember | null>(null);
	const [deleteVerification, setDeleteVerification] = useState("");

	// ─── mutations ───────────────────────────────────────────────────

	const invalidateRatesFor = (userId: string) => {
		qc.invalidateQueries({
			queryKey: ["team", teamId, "rates", "active", userId],
		});
		qc.invalidateQueries({
			queryKey: ["team", teamId, "rates", "history", userId],
		});
	};

	const createMutation = useMutation({
		mutationFn: (input: {
			userId: string;
			payload: Parameters<typeof createMemberRate>[2];
		}) => createMemberRate(teamId, input.userId, input.payload),
		onSuccess: (_, vars) => {
			toast.success("Rate added");
			invalidateRatesFor(vars.userId);
			setAddOpen(false);
			setAddUserId("");
			setAddCustomId("");
			setAddValue("");
			setAddCurrency("USD");
			setAddStartDate("");
			setAddEndDate("");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const updateMutation = useMutation({
		mutationFn: (input: {
			userId: string;
			rateId: string;
			patch: Parameters<typeof updateMemberRate>[3];
		}) => updateMemberRate(teamId, input.userId, input.rateId, input.patch),
		onSuccess: (_, vars) => {
			toast.success("Rate updated");
			invalidateRatesFor(vars.userId);
			setEditing(null);
			setEditingMember(null);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const deleteMutation = useMutation({
		mutationFn: (input: { userId: string; rateId: string }) =>
			deleteMemberRate(teamId, input.userId, input.rateId),
		onSuccess: (_, vars) => {
			toast.success("Rate deleted");
			invalidateRatesFor(vars.userId);
			setDeletingRate(null);
			setDeletingMember(null);
			setDeleteVerification("");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const pendingMemberById = useMemo<Record<string, boolean>>(() => {
		const map: Record<string, boolean> = {};
		if (createMutation.isPending && createMutation.variables)
			map[createMutation.variables.userId] = true;
		if (updateMutation.isPending && updateMutation.variables)
			map[updateMutation.variables.userId] = true;
		if (deleteMutation.isPending && deleteMutation.variables)
			map[deleteMutation.variables.userId] = true;
		return map;
	}, [
		createMutation.isPending,
		createMutation.variables,
		updateMutation.isPending,
		updateMutation.variables,
		deleteMutation.isPending,
		deleteMutation.variables,
	]);

	const pendingRateById = useMemo<Record<string, boolean>>(() => {
		const map: Record<string, boolean> = {};
		if (updateMutation.isPending && updateMutation.variables)
			map[updateMutation.variables.rateId] = true;
		if (deleteMutation.isPending && deleteMutation.variables)
			map[deleteMutation.variables.rateId] = true;
		return map;
	}, [
		updateMutation.isPending,
		updateMutation.variables,
		deleteMutation.isPending,
		deleteMutation.variables,
	]);

	// ─── handlers ────────────────────────────────────────────────────

	const handleSaveAdd = async () => {
		if (!addUserId || !addValue) return;
		await createMutation.mutateAsync({
			userId: addUserId,
			payload: {
				hourly_rate: Number(addValue),
				currency: addCurrency || "USD",
				custom_id: addCustomId || undefined,
				start_date: addStartDate || undefined,
				end_date: addEndDate || undefined,
			},
		});
	};

	const openEditRate = (rate: TeamMemberRate, member: TeamMember | null) => {
		setEditing(rate);
		setEditingMember(member);
		setEditCustomId(rate.custom_id ?? "");
		setEditValue(String(rate.hourly_rate));
		setEditCurrency(rate.currency || "USD");
		setEditStartDate(rate.start_date ?? "");
		setEditEndDate(rate.end_date ?? "");
	};

	const handleSaveEdit = async () => {
		if (!editing) return;
		await updateMutation.mutateAsync({
			userId: editing.user_id,
			rateId: editing.id,
			patch: {
				hourly_rate: editValue === "" ? undefined : Number(editValue),
				currency: editCurrency || undefined,
				custom_id: editCustomId || undefined,
				start_date: editStartDate || undefined,
				end_date: editEndDate || undefined,
			},
		});
	};

	const handleConfirmDelete = async () => {
		if (!deletingRate) return;
		await deleteMutation.mutateAsync({
			userId: deletingRate.user_id,
			rateId: deletingRate.id,
		});
	};

	return (
		<>
			<TeamRatesSection
				members={allMembers}
				activeRateByUserId={activeRateByUserId}
				loadingMembers={membersQuery.isPending}
				loadingRates={loadingRates}
				canManageRates
				pendingMemberById={pendingMemberById}
				onViewLogs={(m) => {
					void navigate({
						to: "/teams/$teamId/time/manage-rates/$userId",
						params: { teamId, userId: m.user_id },
					});
				}}
				onOpenAddRate={() => setAddOpen(true)}
				onManageMember={(m) => setHistoryMember(m)}
			/>

			<TeamMemberRateHistoryDrawer
				isOpen={historyOpen}
				member={historyMember}
				rates={historyQuery.data ?? []}
				loadingRates={historyQuery.isPending}
				canManage
				rowPendingByRateId={pendingRateById}
				onClose={() => setHistoryMember(null)}
				onAddRate={() => {
					if (historyMember) {
						setAddUserId(historyMember.user_id);
						setAddOpen(true);
					}
				}}
				onEditRate={(rate) => openEditRate(rate, historyMember)}
				onDeleteRate={(rate) => {
					setDeletingRate(rate);
					setDeletingMember(historyMember);
				}}
			/>

			<AddRateModal
				isOpen={addOpen}
				canManageRates
				membersWithoutRate={membersWithoutActiveRate}
				loadingMembers={membersQuery.isPending}
				savingRate={createMutation.isPending}
				newRateMemberUserId={addUserId}
				newRateCustomId={addCustomId}
				newRateValue={addValue}
				newRateCurrency={addCurrency}
				newRateStartDate={addStartDate}
				newRateEndDate={addEndDate}
				onClose={() => {
					if (createMutation.isPending) return;
					setAddOpen(false);
				}}
				onCreateRate={handleSaveAdd}
				onChangeMemberUserId={setAddUserId}
				onChangeCustomId={setAddCustomId}
				onChangeRateValue={setAddValue}
				onChangeRateCurrency={setAddCurrency}
				onChangeStartDate={setAddStartDate}
				onChangeEndDate={setAddEndDate}
			/>

			<EditRateModal
				isOpen={Boolean(editing)}
				canManageRates
				editingRate={editing}
				memberLabel={memberDisplayLabel(editingMember)}
				editingRateCustomId={editCustomId}
				editingRateValue={editValue}
				editingRateCurrency={editCurrency}
				editingRateStartDate={editStartDate}
				editingRateEndDate={editEndDate}
				savingRate={updateMutation.isPending}
				onClose={() => {
					if (updateMutation.isPending) return;
					setEditing(null);
					setEditingMember(null);
				}}
				onSave={handleSaveEdit}
				onRequestDelete={() => {
					if (editing) {
						setDeletingRate(editing);
						setDeletingMember(editingMember);
						setEditing(null);
						setEditingMember(null);
					}
				}}
				onChangeCustomId={setEditCustomId}
				onChangeRateValue={setEditValue}
				onChangeRateCurrency={setEditCurrency}
				onChangeStartDate={setEditStartDate}
				onChangeEndDate={setEditEndDate}
			/>

			<DeleteRateModal
				isOpen={Boolean(deletingRate)}
				targetLabel={memberDisplayLabel(deletingMember)}
				verificationText={deleteVerification}
				deletingRate={deleteMutation.isPending}
				onClose={() => {
					if (deleteMutation.isPending) return;
					setDeletingRate(null);
					setDeletingMember(null);
					setDeleteVerification("");
				}}
				onChangeVerificationText={setDeleteVerification}
				onConfirmDelete={handleConfirmDelete}
			/>
		</>
	);
}
