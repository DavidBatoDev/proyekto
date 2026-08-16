import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
	DEFAULT_RATE_TYPE_DRAFT,
	isRateTypeDraftValid,
	type RateTypeDraft,
	toRateTypePayload,
} from "@/components/team-time/MemberRateTypeFields";
import { TeamMemberRateHistoryDrawer } from "@/components/team-time/TeamMemberRateHistoryDrawer";
import { TeamRatesSection } from "@/components/team-time/TeamRatesSection";
import {
	AddRateModal,
	DeleteRateModal,
	EditRateModal,
} from "@/components/team-time/TeamTimeModals";
import { useToast } from "@/hooks/useToast";
import { teamTimeService } from "@/services/team-time.service";
import {
	createMemberRate,
	deleteMemberRate,
	listMemberRates,
	listTeamMembers,
	type TeamMember,
	type TeamMemberRate,
	updateMemberRate,
} from "@/services/teams.service";

export const Route = createFileRoute(
	"/_execution/teams/$teamId/time/manage-rates/",
)({
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

	const membersQuery = useQuery({
		queryKey: ["team", teamId, "members"],
		queryFn: () => listTeamMembers(teamId),
	});
	const allMembers = membersQuery.data ?? [];

	const projectsQuery = useQuery({
		queryKey: ["team-time", teamId, "projects"],
		queryFn: () => teamTimeService.listTeamLogProjects(teamId),
	});
	const attachedProjects = projectsQuery.data ?? [];
	const projectTitleById = useMemo(() => {
		const map: Record<string, string | null> = {};
		for (const p of attachedProjects) map[p.id] = p.title;
		return map;
	}, [attachedProjects]);

	// All rate rows per member. Active filter is computed downstream.
	const ratesQueries = useQueries({
		queries: allMembers.map((m) => ({
			queryKey: ["team", teamId, "rates", "history", m.user_id] as const,
			queryFn: () => listMemberRates(teamId, m.user_id),
			staleTime: 5_000,
		})),
	});
	const ratesByUserId: Record<string, TeamMemberRate[]> = useMemo(() => {
		const map: Record<string, TeamMemberRate[]> = {};
		allMembers.forEach((m, idx) => {
			map[m.user_id] = ratesQueries[idx]?.data ?? [];
		});
		return map;
	}, [allMembers, ratesQueries]);
	const activeRatesByUserId: Record<string, TeamMemberRate[]> = useMemo(() => {
		const map: Record<string, TeamMemberRate[]> = {};
		for (const [userId, rates] of Object.entries(ratesByUserId)) {
			map[userId] = rates.filter((r) => r.end_date === null);
		}
		return map;
	}, [ratesByUserId]);
	const loadingRates = ratesQueries.some((q) => q.isPending);

	// Eligible = member has at least one attached project without an active rate.
	const eligibleMembers = useMemo(() => {
		if (attachedProjects.length === 0) return [];
		const allProjectIds = new Set(attachedProjects.map((p) => p.id));
		return allMembers.filter((m) => {
			const covered = new Set(
				(activeRatesByUserId[m.user_id] ?? []).map((r) => r.project_id),
			);
			for (const pid of allProjectIds) {
				if (!covered.has(pid)) return true;
			}
			return false;
		});
	}, [allMembers, activeRatesByUserId, attachedProjects]);

	// ─── history drawer state ────────────────────────────────────────

	const [historyMember, setHistoryMember] = useState<TeamMember | null>(null);
	const historyOpen = historyMember !== null;
	const historyRates = historyMember
		? (ratesByUserId[historyMember.user_id] ?? [])
		: [];
	const historyLoading = historyMember
		? Boolean(
				ratesQueries[
					allMembers.findIndex((m) => m.user_id === historyMember.user_id)
				]?.isPending,
			)
		: false;

	// ─── Add Rate state ──────────────────────────────────────────────

	const [addOpen, setAddOpen] = useState(false);
	const [addUserId, setAddUserId] = useState("");
	const [addCustomId, setAddCustomId] = useState("");
	const [addValue, setAddValue] = useState("");
	const [addTrainingValue, setAddTrainingValue] = useState("");
	const [addCurrency, setAddCurrency] = useState("USD");
	const [addStartDate, setAddStartDate] = useState("");
	const [addEndDate, setAddEndDate] = useState("");
	const [addRateType, setAddRateType] = useState<RateTypeDraft>(
		DEFAULT_RATE_TYPE_DRAFT,
	);
	const [editRateType, setEditRateType] = useState<RateTypeDraft>(
		DEFAULT_RATE_TYPE_DRAFT,
	);
	const [addScopeMode, setAddScopeMode] = useState<"all" | "specific">("all");
	const [addSelectedProjectIds, setAddSelectedProjectIds] = useState<string[]>(
		[],
	);

	const coveredProjectIdsForAddUser = useMemo(() => {
		if (!addUserId) return [];
		return (activeRatesByUserId[addUserId] ?? []).map((r) => r.project_id);
	}, [activeRatesByUserId, addUserId]);

	useEffect(() => {
		if (!addOpen) return;
		setAddSelectedProjectIds([]);
		setAddScopeMode("all");
	}, [addOpen, addUserId]);

	// ─── Edit Rate state ─────────────────────────────────────────────

	const [editing, setEditing] = useState<TeamMemberRate | null>(null);
	const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
	const [editCustomId, setEditCustomId] = useState("");
	const [editValue, setEditValue] = useState("");
	const [editTrainingValue, setEditTrainingValue] = useState("");
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
			queryKey: ["team", teamId, "rates", "history", userId],
		});
		qc.invalidateQueries({
			queryKey: ["team", teamId, "rates", "active", userId],
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
			setAddTrainingValue("");
			setAddCurrency("USD");
			setAddStartDate("");
			setAddEndDate("");
			setAddSelectedProjectIds([]);
			setAddScopeMode("all");
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
		const coveredSet = new Set(coveredProjectIdsForAddUser);
		const projectIds =
			addScopeMode === "all"
				? attachedProjects.map((p) => p.id).filter((id) => !coveredSet.has(id))
				: addSelectedProjectIds.filter((id) => !coveredSet.has(id));
		if (projectIds.length === 0) {
			toast.error("Pick at least one project that has no active rate yet.");
			return;
		}
		if (!isRateTypeDraftValid(addRateType)) {
			toast.error("A fixed rate needs an amount greater than zero.");
			return;
		}
		await createMutation.mutateAsync({
			userId: addUserId,
			payload: {
				project_ids: projectIds,
				...toRateTypePayload(addRateType),
				hourly_rate: Number(addValue),
				training_hourly_rate: Number(addTrainingValue),
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
		setEditRateType({
			rateType: rate.rate_type ?? "hourly",
			fixedAmount: rate.fixed_amount == null ? "" : String(rate.fixed_amount),
			fixedPeriod: rate.fixed_period ?? "month",
		});
		setEditValue(String(rate.hourly_rate));
		setEditTrainingValue(String(rate.training_hourly_rate));
		setEditCurrency(rate.currency || "USD");
		setEditStartDate(rate.start_date ?? "");
		setEditEndDate(rate.end_date ?? "");
	};

	const handleSaveEdit = async () => {
		if (!editing) return;
		if (!isRateTypeDraftValid(editRateType)) {
			toast.error("A fixed rate needs an amount greater than zero.");
			return;
		}
		await updateMutation.mutateAsync({
			userId: editing.user_id,
			rateId: editing.id,
			patch: {
				...toRateTypePayload(editRateType),
				hourly_rate: editValue === "" ? undefined : Number(editValue),
				training_hourly_rate:
					editTrainingValue === "" ? undefined : Number(editTrainingValue),
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
				activeRatesByUserId={activeRatesByUserId}
				projectTitleById={projectTitleById}
				loadingMembers={membersQuery.isPending}
				loadingRates={loadingRates}
				canManageRates
				pendingMemberById={pendingMemberById}
				onViewLogs={(m) => {
					// Team Logs, pre-filtered to this member (replaces the old
					// per-member sub-page).
					void navigate({
						to: "/teams/$teamId/time/team-logs",
						params: { teamId },
						search: { member: m.user_id },
					});
				}}
				onOpenAddRate={() => setAddOpen(true)}
				onManageMember={(m) => setHistoryMember(m)}
			/>

			<TeamMemberRateHistoryDrawer
				isOpen={historyOpen}
				member={historyMember}
				rates={historyRates}
				projectTitleById={projectTitleById}
				loadingRates={historyLoading}
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
				eligibleMembers={eligibleMembers}
				loadingMembers={membersQuery.isPending}
				savingRate={createMutation.isPending}
				newRateMemberUserId={addUserId}
				newRateCustomId={addCustomId}
				newRateValue={addValue}
				newRateTrainingValue={addTrainingValue}
				newRateCurrency={addCurrency}
				newRateStartDate={addStartDate}
				newRateEndDate={addEndDate}
				attachedProjects={attachedProjects}
				coveredProjectIds={coveredProjectIdsForAddUser}
				scopeMode={addScopeMode}
				selectedProjectIds={addSelectedProjectIds}
				rateTypeDraft={addRateType}
				onChangeRateTypeDraft={(updates) =>
					setAddRateType((prev) => ({ ...prev, ...updates }))
				}
				onClose={() => {
					if (createMutation.isPending) return;
					setAddOpen(false);
				}}
				onCreateRate={handleSaveAdd}
				onChangeMemberUserId={setAddUserId}
				onChangeCustomId={setAddCustomId}
				onChangeRateValue={setAddValue}
				onChangeRateTrainingValue={setAddTrainingValue}
				onChangeRateCurrency={setAddCurrency}
				onChangeStartDate={setAddStartDate}
				onChangeEndDate={setAddEndDate}
				onChangeScopeMode={setAddScopeMode}
				onChangeSelectedProjectIds={setAddSelectedProjectIds}
			/>

			<EditRateModal
				isOpen={Boolean(editing)}
				canManageRates
				editingRate={editing}
				memberLabel={memberDisplayLabel(editingMember)}
				editingRateCustomId={editCustomId}
				editingRateValue={editValue}
				editingRateTrainingValue={editTrainingValue}
				editingRateCurrency={editCurrency}
				editingRateStartDate={editStartDate}
				editingRateEndDate={editEndDate}
				savingRate={updateMutation.isPending}
				rateTypeDraft={editRateType}
				onChangeRateTypeDraft={(updates) =>
					setEditRateType((prev) => ({ ...prev, ...updates }))
				}
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
				onChangeRateTrainingValue={setEditTrainingValue}
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
