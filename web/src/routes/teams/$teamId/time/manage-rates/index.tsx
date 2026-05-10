import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/useToast";
import {
	listTeamMembers,
	updateTeamMember,
	type TeamMember,
} from "@/services/teams.service";
import { TeamRatesSection } from "@/components/team-time/TeamRatesSection";
import {
	AddRateModal,
	DeleteRateModal,
	EditRateModal,
} from "@/components/team-time/TeamTimeModals";

export const Route = createFileRoute("/teams/$teamId/time/manage-rates/")({
	component: ManageRatesTab,
});

function ManageRatesTab() {
	const { teamId } = Route.useParams();
	const toast = useToast();
	const qc = useQueryClient();
	const navigate = useNavigate();

	const membersQuery = useQuery({
		queryKey: ["team", teamId, "members"],
		queryFn: () => listTeamMembers(teamId),
	});

	// Editing state
	const [editing, setEditing] = useState<TeamMember | null>(null);
	const [editCustomId, setEditCustomId] = useState("");
	const [editValue, setEditValue] = useState("");
	const [editCurrency, setEditCurrency] = useState("USD");
	const [editStartDate, setEditStartDate] = useState("");
	const [editEndDate, setEditEndDate] = useState("");

	// Add state
	const [addOpen, setAddOpen] = useState(false);
	const [addUserId, setAddUserId] = useState("");
	const [addCustomId, setAddCustomId] = useState("");
	const [addValue, setAddValue] = useState("");
	const [addCurrency, setAddCurrency] = useState("USD");
	const [addStartDate, setAddStartDate] = useState("");
	const [addEndDate, setAddEndDate] = useState("");

	// Delete state (delete = clear all rate fields → null)
	const [deleting, setDeleting] = useState<TeamMember | null>(null);
	const [deleteVerification, setDeleteVerification] = useState("");

	const allMembers = membersQuery.data ?? [];
	const membersWithoutRate = useMemo(
		() => allMembers.filter((m) => m.hourly_rate == null),
		[allMembers],
	)

	const saveRateMutation = useMutation({
		mutationFn: (input: {
			userId: string;
			patch: Parameters<typeof updateTeamMember>[2];
		}) => updateTeamMember(teamId, input.userId, input.patch),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["team", teamId, "members"] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const pendingMemberById = useMemo<Record<string, boolean>>(() => {
		if (saveRateMutation.isPending && saveRateMutation.variables)
			return { [saveRateMutation.variables.userId]: true };
		return {};
	}, [saveRateMutation.isPending, saveRateMutation.variables]);

	const openEdit = (m: TeamMember) => {
		setEditing(m);
		setEditCustomId(m.custom_id ?? "");
		setEditValue(m.hourly_rate != null ? String(m.hourly_rate) : "");
		setEditCurrency(m.currency ?? "USD");
		setEditStartDate(m.start_date ?? "");
		setEditEndDate(m.end_date ?? "");
	}

	const closeEdit = () => {
		if (saveRateMutation.isPending) return;
		setEditing(null);
	}

	const handleSaveEdit = async () => {
		if (!editing) return;
		await saveRateMutation.mutateAsync({
			userId: editing.user_id,
			patch: {
				hourly_rate: editValue === "" ? undefined : Number(editValue),
				currency: editCurrency || undefined,
				custom_id: editCustomId || undefined,
				start_date: editStartDate || undefined,
				end_date: editEndDate || undefined,
			},
		})
		toast.success("Rate updated");
		setEditing(null);
	}

	const handleSaveAdd = async () => {
		if (!addUserId || !addValue) return;
		await saveRateMutation.mutateAsync({
			userId: addUserId,
			patch: {
				hourly_rate: Number(addValue),
				currency: addCurrency || "USD",
				custom_id: addCustomId || undefined,
				start_date: addStartDate || undefined,
				end_date: addEndDate || undefined,
			},
		})
		toast.success("Rate added");
		setAddOpen(false);
		setAddUserId("");
		setAddCustomId("");
		setAddValue("");
		setAddCurrency("USD");
		setAddStartDate("");
		setAddEndDate("");
	}

	const handleConfirmDelete = async () => {
		if (!deleting) return;
		// Clear all rate fields. Backend currently doesn't accept null
		// directly via the existing PATCH; pass 0 + empty strings, which
		// the service stores as zero-rate. Effectively disables logging.
		await saveRateMutation.mutateAsync({
			userId: deleting.user_id,
			patch: {
				hourly_rate: 0,
				currency: deleting.currency ?? "USD",
				custom_id: undefined,
				start_date: undefined,
				end_date: undefined,
			},
		})
		toast.success("Rate cleared");
		setDeleting(null);
		setDeleteVerification("");
	}

	return (
		<>
			<TeamRatesSection
				members={allMembers}
				loadingMembers={membersQuery.isPending}
				canManageRates
				pendingMemberById={pendingMemberById}
				onViewLogs={(m) => {
					void navigate({
						to: "/teams/$teamId/time/manage-rates/$userId",
						params: { teamId, userId: m.user_id },
					});
				}}
				onOpenAddRate={() => setAddOpen(true)}
				onOpenEditRate={openEdit}
			/>

			<AddRateModal
				isOpen={addOpen}
				canManageRates
				membersWithoutRate={membersWithoutRate}
				loadingMembers={membersQuery.isPending}
				savingRate={saveRateMutation.isPending}
				newRateMemberUserId={addUserId}
				newRateCustomId={addCustomId}
				newRateValue={addValue}
				newRateCurrency={addCurrency}
				newRateStartDate={addStartDate}
				newRateEndDate={addEndDate}
				onClose={() => {
					if (saveRateMutation.isPending) return;
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
				editingRateTarget={editing}
				editingRateCustomId={editCustomId}
				editingRateValue={editValue}
				editingRateCurrency={editCurrency}
				editingRateStartDate={editStartDate}
				editingRateEndDate={editEndDate}
				savingRate={saveRateMutation.isPending}
				onClose={closeEdit}
				onSave={handleSaveEdit}
				onRequestDelete={() => {
					if (editing) {
						setDeleting(editing);
						setEditing(null)
					}
				}}
				onChangeCustomId={setEditCustomId}
				onChangeRateValue={setEditValue}
				onChangeRateCurrency={setEditCurrency}
				onChangeStartDate={setEditStartDate}
				onChangeEndDate={setEditEndDate}
			/>

			<DeleteRateModal
				isOpen={Boolean(deleting)}
				targetLabel={
					deleting?.user?.display_name ??
					deleting?.user?.email ??
					deleting?.user_id
				}
				verificationText={deleteVerification}
				deletingRate={saveRateMutation.isPending}
				onClose={() => {
					if (saveRateMutation.isPending) return;
					setDeleting(null);
					setDeleteVerification("");
				}}
				onChangeVerificationText={setDeleteVerification}
				onConfirmDelete={handleConfirmDelete}
			/>
		</>
	)
}
