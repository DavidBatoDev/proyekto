import {
	useState,
	useEffect,
	useRef,
	useMemo,
	useCallback,
	type FormEvent,
} from "react";
import {
	Plus,
	Edit2,
	ChevronDown,
	ChevronUp,
	Calendar,
	X,
	Search,
	Check,
} from "lucide-react";
import type {
	AssigneeProfile,
	Comment,
	RoadmapFeature,
	RoadmapTask,
} from "@/types/roadmap";
import { projectService, type ProjectMember } from "@/services/project.service";
import { deriveFeatureStatus } from "@/utils/featureStatus";
import { useUser } from "@/auth";
import { useShallow } from "zustand/react/shallow";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { useToast } from "@/hooks/useToast";
import { RoadmapModalLayout } from "./RoadmapModalLayout";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import { SortableTaskList } from "../widgets/SortableTaskList";
import { CommentsSection } from "../shared/CommentsSection";
import { commentsService } from "@/services/roadmap.service";
import { UnsavedChangesConfirmModal } from "../shared/UnsavedChangesConfirmModal";
import {
	calculateFeatureProgressFromTasks,
	getCompletedTaskCount,
} from "../shared/featureProgress";

interface FeatureModalProps {
	isOpen: boolean;
	epicTitle?: string;
	initialData?: RoadmapFeature;
	titleText?: string;
	submitLabel?: string;
	onClose: () => void;
	onAddTask?: (featureId: string) => void | Promise<void>;
	onUpdateTask?: (task: RoadmapTask) => void | Promise<void>;
	onDeleteTask?: (taskId: string) => void | Promise<void>;
	onSelectTask?: (task: RoadmapTask) => void;
	onSubmit: (data: {
		title: string;
		description: string;
		is_deliverable: boolean;
		start_date?: string;
		end_date?: string;
		assignee_ids?: string[];
	}) => void;
	isLoading?: boolean;
	isPendingCreate?: boolean;
}

export const FeatureModal = ({
	isOpen,
	epicTitle: _epicTitle,
	initialData,
	titleText: _titleText = "Add Feature",
	submitLabel = "Create Feature",
	onClose,
	onAddTask,
	onUpdateTask,
	onDeleteTask,
	onSelectTask,
	onSubmit,
	isLoading = false,
	isPendingCreate = false,
}: FeatureModalProps) => {
	const user = useUser();
	const toast = useToast();
	const {
		milestones,
		reassignFeatureToMilestone,
		pendingCommentId,
		setPendingCommentId,
		reorderTasksInFeature,
	} = useRoadmapStore(
		useShallow((s) => ({
			milestones: s.milestones,
			reassignFeatureToMilestone: s.reassignFeatureToMilestone,
			pendingCommentId: s.pendingCommentId,
			setPendingCommentId: s.setPendingCommentId,
			reorderTasksInFeature: s.reorderTasksInFeature,
		})),
	);
	const projectId = useRoadmapStore((s) => s.roadmap?.project_id ?? null);
	const currentMilestoneId = useMemo(() => {
		if (!initialData?.id) return null;
		const match = milestones.find((m) =>
			(m.linked_features ?? []).some((f) => f.id === initialData.id),
		);
		return match?.id ?? null;
	}, [initialData?.id, milestones]);
	const [milestonePending, setMilestonePending] = useState(false);
	const handleMilestoneChange = async (nextMilestoneId: string) => {
		if (!initialData?.id) return;
		const toId = nextMilestoneId === "" ? null : nextMilestoneId;
		if (toId === currentMilestoneId) return;
		setMilestonePending(true);
		try {
			await reassignFeatureToMilestone(
				initialData.id,
				currentMilestoneId,
				toId,
			);
			toast.success(
				toId
					? "Feature moved to milestone"
					: "Feature unassigned from milestone",
			);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to update milestone",
			);
		} finally {
			setMilestonePending(false);
		}
	};
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [isDeliverable, setIsDeliverable] = useState(false);
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");
	const [draftStartDate, setDraftStartDate] = useState("");
	const [draftEndDate, setDraftEndDate] = useState("");
	const [isDateMenuOpen, setIsDateMenuOpen] = useState(false);
	const [isEditingDescription, setIsEditingDescription] = useState(false);
	const [isExpanded, setIsExpanded] = useState(false);
	const [showReadMore, setShowReadMore] = useState(false);
	const [showUnsavedChangesConfirm, setShowUnsavedChangesConfirm] =
		useState(false);
	const [comments, setComments] = useState<Comment[]>([]);
	const [loadingComments, setLoadingComments] = useState(false);
	// The explicit feature team (editable). Initialized from initialData.
	const [featureAssigneeIds, setFeatureAssigneeIds] = useState<string[]>([]);
	const [featureAssigneeProfiles, setFeatureAssigneeProfiles] = useState<
		AssigneeProfile[]
	>([]);
	const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
	const [isTeamMenuOpen, setIsTeamMenuOpen] = useState(false);
	const [teamSearch, setTeamSearch] = useState("");
	const teamMenuRef = useRef<HTMLDivElement>(null);
	const descriptionRef = useRef<HTMLDivElement>(null);
	const initialSnapshotRef = useRef<{
		title: string;
		description: string;
		isDeliverable: boolean;
		startDate: string;
		endDate: string;
		assigneeKey: string;
	} | null>(null);
	const isReadOnlyPending = isPendingCreate;

	// Populate form from initialData when modal opens
	useEffect(() => {
		if (isOpen) {
			const initialProfiles = initialData?.assignees ?? [];
			const initialIds =
				initialData?.assignee_ids ?? initialProfiles.map((p) => p.id);
			const nextInitialValues = {
				title: initialData?.title ?? "",
				description: initialData?.description ?? "",
				isDeliverable: initialData?.is_deliverable ?? false,
				startDate: initialData?.start_date?.slice(0, 10) ?? "",
				endDate: initialData?.end_date?.slice(0, 10) ?? "",
				assigneeKey: [...initialIds].sort().join(","),
			};
			initialSnapshotRef.current = nextInitialValues;

			setTitle(nextInitialValues.title);
			setDescription(nextInitialValues.description);
			setIsDeliverable(nextInitialValues.isDeliverable);
			setStartDate(nextInitialValues.startDate);
			setEndDate(nextInitialValues.endDate);
			setDraftStartDate(nextInitialValues.startDate);
			setDraftEndDate(nextInitialValues.endDate);
			setFeatureAssigneeIds(initialIds);
			setFeatureAssigneeProfiles(initialProfiles);
			setIsDateMenuOpen(false);
			setIsTeamMenuOpen(false);
			setTeamSearch("");
			setIsEditingDescription(false);
			setIsExpanded(false);
			setShowUnsavedChangesConfirm(false);
		}
	}, [isOpen, initialData?.id]);

	// Load project members for the feature-team picker.
	useEffect(() => {
		if (!isOpen || !projectId) return;
		let cancelled = false;
		void (async () => {
			try {
				const members = await projectService.getMembers(projectId);
				if (!cancelled) setProjectMembers(members);
			} catch {
				if (!cancelled) setProjectMembers([]);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [isOpen, projectId]);

	// Close the team menu when clicking outside it.
	useEffect(() => {
		if (!isTeamMenuOpen) return;
		const handlePointerDown = (event: MouseEvent) => {
			if (!teamMenuRef.current?.contains(event.target as Node)) {
				setIsTeamMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", handlePointerDown);
		return () => document.removeEventListener("mousedown", handlePointerDown);
	}, [isTeamMenuOpen]);

	useEffect(() => {
		if (!isOpen) {
			setShowUnsavedChangesConfirm(false);
		}
	}, [isOpen]);

	useEffect(() => {
		// Check if content needs "Show more" button after render
		const checkHeight = () => {
			if (descriptionRef.current && description && !isEditingDescription) {
				const needsShowMore = descriptionRef.current.scrollHeight > 192; // 192px = max-h-48
				setShowReadMore(needsShowMore);
			} else {
				setShowReadMore(false);
			}
		};

		// Use setTimeout to ensure DOM has updated
		const timer = setTimeout(checkHeight, 100);
		return () => clearTimeout(timer);
	}, [description, isEditingDescription, isOpen]);

	const submitCurrentValues = () => {
		onSubmit({
			title,
			description,
			is_deliverable: isDeliverable,
			start_date: startDate || undefined,
			end_date: endDate || undefined,
			assignee_ids: featureAssigneeIds,
		});

		// Reset form only if not in edit mode
		if (!initialData) {
			setTitle("");
			setDescription("");
			setIsDeliverable(false);
			setFeatureAssigneeIds([]);
			setFeatureAssigneeProfiles([]);
		}
	};

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		submitCurrentValues();
	};

	const assigneeKey = useMemo(
		() => [...featureAssigneeIds].sort().join(","),
		[featureAssigneeIds],
	);

	const hasUnsavedChanges = useMemo(() => {
		const snapshot = initialSnapshotRef.current;
		if (!snapshot) return false;

		return (
			title !== snapshot.title ||
			description !== snapshot.description ||
			isDeliverable !== snapshot.isDeliverable ||
			startDate !== snapshot.startDate ||
			endDate !== snapshot.endDate ||
			assigneeKey !== snapshot.assigneeKey
		);
	}, [description, endDate, isDeliverable, startDate, title, assigneeKey]);

	const handleRequestClose = () => {
		if (isLoading) return;
		if (hasUnsavedChanges) {
			setShowUnsavedChangesConfirm(true);
			return;
		}
		onClose();
	};

	const handleDiscardChanges = () => {
		setShowUnsavedChangesConfirm(false);
		onClose();
	};

	const handleSaveBeforeClose = () => {
		if (isLoading || isReadOnlyPending || !title.trim()) return;
		setShowUnsavedChangesConfirm(false);
		submitCurrentValues();
		onClose();
	};

	const hasDates = Boolean(startDate || endDate);

	const formatDate = (value?: string) => {
		if (!value) return "";
		return new Date(value).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			year: "numeric",
		});
	};

	const displayDateRange = `${startDate ? formatDate(startDate) : "No start"} - ${endDate ? formatDate(endDate) : "No end"}`;

	const openDateMenu = () => {
		setDraftStartDate(startDate);
		setDraftEndDate(endDate);
		setIsDateMenuOpen(true);
	};

	const saveDates = () => {
		setStartDate(draftStartDate);
		setEndDate(draftEndDate);
		setIsDateMenuOpen(false);
	};

	const removeDates = () => {
		setStartDate("");
		setEndDate("");
		setDraftStartDate("");
		setDraftEndDate("");
		setIsDateMenuOpen(false);
	};

	const tasks: RoadmapTask[] =
		(initialData?.tasks as RoadmapTask[] | undefined) ?? [];
	// Union of every assignee across child tasks (handles both the legacy single
	// assignee and the new multi-assignee array).
	const featureAssignees = useMemo(() => {
		const deduped = new Map<string, AssigneeProfile>();

		for (const task of tasks) {
			for (const profile of task.assignees ?? []) {
				if (profile?.id && !deduped.has(profile.id)) {
					deduped.set(profile.id, profile);
				}
			}
			const legacyId = task.assignee_id ?? task.assignee?.id;
			if (legacyId && task.assignee && !deduped.has(legacyId)) {
				deduped.set(legacyId, task.assignee);
			}
		}

		return Array.from(deduped.values());
	}, [tasks]);
	const featureId = initialData?.id;
	const loadComments = async () => {
		if (!featureId) return;

		try {
			setLoadingComments(true);
			const fetched = await commentsService.getFeatureComments(featureId);
			setComments(fetched);
		} catch (error) {
			console.error("Failed to load feature comments:", error);
			setComments([]);
		} finally {
			setLoadingComments(false);
		}
	};

	useEffect(() => {
		if (!isOpen) {
			setComments([]);
			setLoadingComments(false);
			return;
		}

		if (featureId) {
			void loadComments();
		}
	}, [isOpen, featureId]);

	const handleAddComment = async (content: string) => {
		if (!featureId) return;
		const created = await commentsService.addFeatureComment(featureId, content);
		setComments((prev) => [...prev, created]);
	};

	const handleUpdateComment = async (commentId: string, content: string) => {
		if (!featureId) return;
		const updated = await commentsService.updateFeatureComment(
			featureId,
			commentId,
			content,
		);
		setComments((prev) =>
			prev.map((comment) => (comment.id === commentId ? updated : comment)),
		);
	};

	const handleDeleteComment = async (commentId: string) => {
		if (!featureId) return;
		await commentsService.deleteFeatureComment(featureId, commentId);
		setComments((prev) => prev.filter((comment) => comment.id !== commentId));
	};
	const handleReorderTasks = useCallback(
		(fId: string, orderedIds: string[]) => {
			void reorderTasksInFeature(fId, orderedIds);
		},
		[reorderTasksInFeature],
	);

	const autoProgress = calculateFeatureProgressFromTasks(tasks);
	const completedTasks = getCompletedTaskCount(tasks);

	const renderAssigneeAvatar = (
		assignee: NonNullable<RoadmapTask["assignee"]>,
	) => {
		if (assignee.avatar_url) {
			return (
				<img
					src={assignee.avatar_url}
					alt={assignee.display_name ?? assignee.email ?? "Assignee"}
					className="w-6 h-6 rounded-full object-cover ring-1 ring-white"
				/>
			);
		}

		const source = assignee.display_name ?? assignee.email ?? "?";
		const initials = source
			.split(" ")
			.map((part) => part[0])
			.join("")
			.slice(0, 2)
			.toUpperCase();

		return (
			<div className="w-6 h-6 rounded-full bg-black text-white text-[9px] font-bold flex items-center justify-center ring-1 ring-white">
				{initials}
			</div>
		);
	};

	const teamMemberOptions = useMemo(() => {
		const q = teamSearch.trim().toLowerCase();
		return projectMembers
			.map((m) => {
				const id = m.user_id || m.user?.id;
				if (!id) return null;
				const profile: AssigneeProfile = {
					id,
					display_name: m.user?.display_name,
					avatar_url: m.user?.avatar_url ?? undefined,
					email: m.user?.email,
					first_name: m.user?.first_name,
					last_name: m.user?.last_name,
				};
				const name = profile.display_name || profile.email || "Member";
				return { id, name, profile };
			})
			.filter(
				(
					opt,
				): opt is { id: string; name: string; profile: AssigneeProfile } => {
					if (!opt) return false;
					if (!q) return true;
					return (
						opt.name.toLowerCase().includes(q) ||
						(opt.profile.email ?? "").toLowerCase().includes(q)
					);
				},
			);
	}, [projectMembers, teamSearch]);

	const toggleTeamMember = (opt: { id: string; profile: AssigneeProfile }) => {
		const has = featureAssigneeIds.includes(opt.id);
		if (has) {
			setFeatureAssigneeIds((ids) => ids.filter((x) => x !== opt.id));
			setFeatureAssigneeProfiles((ps) => ps.filter((p) => p.id !== opt.id));
		} else {
			setFeatureAssigneeIds((ids) => [...ids, opt.id]);
			setFeatureAssigneeProfiles((ps) =>
				ps.some((p) => p.id === opt.id) ? ps : [...ps, opt.profile],
			);
		}
	};

	const body = (
		<>
			<div
				className={
					isReadOnlyPending ? "pointer-events-none opacity-70" : undefined
				}
			>
				{/* Status (derived from tasks) and Deliverable Row */}
				<div className="flex flex-col gap-4 mb-6 md:flex-row md:gap-6">
					{/* Status — read-only, derived from child task statuses */}
					<div className="flex-1">
						<h3 className="text-sm font-semibold text-gray-900 mb-2">Status</h3>
						<div className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-200 rounded-md bg-gray-50 capitalize">
							{deriveFeatureStatus(initialData?.tasks).replace(/_/g, " ")}
						</div>
						<p className="mt-1 text-xs text-gray-500">
							Derived from task statuses
						</p>
					</div>

					{/* Is Deliverable */}
					<div className="w-full md:w-48">
						<h3 className="text-sm font-semibold text-gray-900 mb-2">
							Deliverable
						</h3>
						<label className="flex items-center gap-2 cursor-pointer h-[42px]">
							<input
								type="checkbox"
								checked={isDeliverable}
								onChange={(e) => setIsDeliverable(e.target.checked)}
								className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
							/>
							<span className="text-sm text-gray-700">Milestone progress</span>
						</label>
					</div>
				</div>

				{/* Milestone (soft phases): assign feature to any milestone — past or future */}
				{initialData?.id && (
					<div className="mb-6">
						<h3 className="text-sm font-semibold text-gray-900 mb-2">
							Milestone
						</h3>
						<select
							value={currentMilestoneId ?? ""}
							disabled={milestonePending}
							onChange={(e) => void handleMilestoneChange(e.target.value)}
							className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-white disabled:opacity-60"
						>
							<option value="">Unassigned</option>
							{milestones.map((milestone) => (
								<option key={milestone.id} value={milestone.id}>
									{milestone.title}
								</option>
							))}
						</select>
						<p className="mt-1 text-xs text-gray-500">
							Any milestone is selectable — phases are flexible.
						</p>
					</div>
				)}

				{/* Progress (auto-calculated from task statuses) */}
				<div className="mb-6">
					<div className="flex items-center justify-between text-sm text-gray-700 mb-1.5">
						<h3 className="font-semibold text-gray-900">Progress</h3>
						<span className="font-medium">{autoProgress}%</span>
					</div>
					<div className="h-2 bg-gray-200 rounded-full overflow-hidden">
						<div
							className="h-full bg-primary transition-all duration-300"
							style={{ width: `${autoProgress}%` }}
						/>
					</div>
					<p className="mt-1 text-xs text-gray-500">
						Auto-calculated from tasks: {completedTasks}/{tasks.length} done
					</p>
				</div>

				{/* Feature team (editable) */}
				<div className="mb-6">
					<h3 className="text-sm font-semibold text-gray-900 mb-2">
						Feature team
					</h3>
					<div className="relative" ref={teamMenuRef}>
						<button
							type="button"
							onClick={() => setIsTeamMenuOpen((prev) => !prev)}
							disabled={isReadOnlyPending}
							className="flex items-center gap-2 min-h-[42px] w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md bg-white hover:bg-gray-50 transition-colors disabled:opacity-60"
						>
							{featureAssigneeProfiles.length > 0 ? (
								<span className="flex items-center flex-1 min-w-0">
									<span className="flex items-center">
										{featureAssigneeProfiles.slice(0, 6).map((p, index) => (
											<span
												key={p.id}
												className={index > 0 ? "-ml-1.5" : ""}
												title={p.display_name ?? p.email ?? "Assignee"}
											>
												{renderAssigneeAvatar(p)}
											</span>
										))}
										{featureAssigneeProfiles.length > 6 && (
											<span className="-ml-1.5 w-6 h-6 rounded-full bg-gray-100 border border-white flex items-center justify-center text-[9px] font-semibold text-gray-600">
												+{featureAssigneeProfiles.length - 6}
											</span>
										)}
									</span>
									<span className="ml-2 truncate text-gray-600">
										{featureAssigneeProfiles.length}{" "}
										{featureAssigneeProfiles.length === 1
											? "member"
											: "members"}
									</span>
								</span>
							) : (
								<span className="flex-1 text-left text-gray-500">
									Add team members
								</span>
							)}
							<ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
						</button>

						{isTeamMenuOpen && (
							<div className="absolute z-30 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg p-2">
								<div className="relative mb-2">
									<Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
									<input
										type="text"
										value={teamSearch}
										onChange={(e) => setTeamSearch(e.target.value)}
										placeholder="Search members..."
										className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20"
									/>
								</div>
								<div className="max-h-56 overflow-y-auto">
									{teamMemberOptions.map((opt) => {
										const selected = featureAssigneeIds.includes(opt.id);
										return (
											<button
												key={opt.id}
												type="button"
												onClick={() => toggleTeamMember(opt)}
												className="w-full px-2 py-2 text-left text-sm rounded-md hover:bg-gray-50 flex items-center justify-between gap-2"
											>
												<span className="flex items-center gap-2 min-w-0">
													{renderAssigneeAvatar(opt.profile)}
													<span className="truncate text-gray-700">
														{opt.name}
													</span>
												</span>
												{selected && (
													<Check className="w-4 h-4 text-primary shrink-0" />
												)}
											</button>
										);
									})}
									{teamMemberOptions.length === 0 && (
										<p className="px-2 py-2 text-xs text-gray-400">
											No members found
										</p>
									)}
								</div>
							</div>
						)}
					</div>
					<p className="mt-1 text-xs text-gray-500">
						Quick-pick group when assigning tasks in this feature.
					</p>
				</div>

				{/* Assignees (derived from child tasks) */}
				<div className="mb-6">
					<h3 className="text-sm font-semibold text-gray-900 mb-2">
						Task assignees
					</h3>
					{featureAssignees.length > 0 ? (
						<div className="flex items-center">
							{featureAssignees.slice(0, 6).map((assignee, index) => (
								<div
									key={assignee.id}
									className={index > 0 ? "-ml-1.5" : ""}
									title={assignee.display_name ?? assignee.email ?? "Assignee"}
								>
									{renderAssigneeAvatar(assignee)}
								</div>
							))}
							{featureAssignees.length > 6 && (
								<span className="-ml-1.5 w-6 h-6 rounded-full bg-gray-100 border border-white flex items-center justify-center text-[9px] font-semibold text-gray-600">
									+{featureAssignees.length - 6}
								</span>
							)}
						</div>
					) : (
						<p className="text-xs text-gray-500">
							No one assigned across tasks yet
						</p>
					)}
				</div>

				{/* Dates */}
				<div
					className={`relative ${hasDates || isDateMenuOpen ? "mb-6" : "mb-0"}`}
				>
					{hasDates && (
						<button
							type="button"
							onClick={openDateMenu}
							className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-900 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
						>
							<Calendar className="w-4 h-4 text-gray-500" />
							{displayDateRange}
							<ChevronDown className="w-4 h-4 text-gray-500" />
						</button>
					)}

					{isDateMenuOpen && (
						<div className="absolute z-20 mt-2 w-full max-w-[420px] rounded-xl border border-gray-200 bg-white shadow-xl p-4">
							<div className="flex items-center justify-between mb-3">
								<h3 className="text-sm font-semibold text-gray-900">Dates</h3>
								<button
									type="button"
									onClick={() => setIsDateMenuOpen(false)}
									className="p-1 rounded hover:bg-gray-100"
								>
									<X className="w-4 h-4 text-gray-500" />
								</button>
							</div>

							<div className="space-y-3">
								<div>
									<label className="block text-xs font-medium text-gray-600 mb-1">
										Start date
									</label>
									<input
										type="date"
										value={draftStartDate}
										onChange={(e) => setDraftStartDate(e.target.value)}
										className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-white"
									/>
								</div>
								<div>
									<label className="block text-xs font-medium text-gray-600 mb-1">
										End date
									</label>
									<input
										type="date"
										value={draftEndDate}
										onChange={(e) => setDraftEndDate(e.target.value)}
										min={draftStartDate || undefined}
										className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-white"
									/>
								</div>
							</div>

							<div className="mt-4 flex justify-end gap-2">
								<button
									type="button"
									onClick={removeDates}
									className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
								>
									Remove
								</button>
								<button
									type="button"
									onClick={saveDates}
									className="px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 transition-colors"
								>
									Save
								</button>
							</div>
						</div>
					)}
				</div>

				{/* Description */}
				<div className="mb-6">
					<div className="flex items-center justify-between mb-2">
						<h3 className="text-sm font-semibold text-gray-900">Description</h3>
						{!isEditingDescription && description && (
							<button
								type="button"
								onClick={() => setIsEditingDescription(true)}
								className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 rounded transition-colors"
							>
								<Edit2 className="w-3.5 h-3.5" />
								Edit
							</button>
						)}
					</div>

					{isEditingDescription ? (
						<div className="space-y-2">
							<RichTextEditor
								value={description}
								onChange={setDescription}
								placeholder="Add a more detailed description..."
								tools={[
									"textFormat",
									"bold",
									"italic",
									"more",
									"separator",
									"bulletList",
									"numberedList",
									"separator",
									"link",
									"image",
								]}
								minHeight="100px"
								maxHeight="none"
								autoFocus
							/>
							<div className="flex justify-end">
								<button
									type="button"
									onClick={() => setIsEditingDescription(false)}
									className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
								>
									Done
								</button>
							</div>
						</div>
					) : description ? (
						<div className="relative">
							<div
								ref={descriptionRef}
								className={`relative text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none overflow-hidden transition-[max-height] duration-300 ease-in-out ${
									isExpanded ? "max-h-[2000px]" : "max-h-48"
								}`}
							>
								<div dangerouslySetInnerHTML={{ __html: description }} />

								{/* Gradient Overlay when collapsed */}
								{!isExpanded && showReadMore && (
									<div className="absolute bottom-0 left-0 right-0 h-12 bg-linear-to-t from-white to-transparent pointer-events-none" />
								)}
							</div>

							{/* Show More / Less Button */}
							{showReadMore && (
								<button
									type="button"
									onClick={() => setIsExpanded(!isExpanded)}
									className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
								>
									{isExpanded ? (
										<>
											Show less <ChevronUp className="w-3 h-3" />
										</>
									) : (
										<>
											Show more <ChevronDown className="w-3 h-3" />
										</>
									)}
								</button>
							)}
						</div>
					) : (
						<button
							type="button"
							onClick={() => setIsEditingDescription(true)}
							className="w-full px-3 py-2 text-sm text-gray-500 border border-gray-300 border-dashed rounded-md hover:border-gray-400 hover:bg-gray-50 transition-colors text-left"
						>
							Add a description...
						</button>
					)}
				</div>
			</div>
		</>
	);

	const footer = (
		<div className="flex justify-end">
			<button
				type="submit"
				disabled={!title.trim() || isLoading || isReadOnlyPending}
				className="px-6 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
			>
				{isLoading ? (
					<>
						<div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
						Saving...
					</>
				) : isReadOnlyPending ? (
					"Creating..."
				) : (
					submitLabel
				)}
			</button>
		</div>
	);

	const rightPanelTabs = [
		{
			id: "comments",
			label: "Comments",
			content: featureId ? (
				<CommentsSection
					comments={comments}
					onAddComment={handleAddComment}
					onUpdateComment={isReadOnlyPending ? undefined : handleUpdateComment}
					onDeleteComment={isReadOnlyPending ? undefined : handleDeleteComment}
					currentUserId={user?.id}
					canComment={Boolean(user) && !isReadOnlyPending}
					disabledMessage={
						isReadOnlyPending
							? "Comments will unlock once this feature is created."
							: undefined
					}
					isLoading={loadingComments}
					emptyMessage="No comments yet for this feature."
					highlightCommentId={pendingCommentId ?? undefined}
					onHighlightConsumed={() => setPendingCommentId(null)}
				/>
			) : (
				<div className="text-center py-8">
					<p className="text-sm text-gray-500">
						Save feature first to add comments
					</p>
				</div>
			),
		},
		{
			id: "tasks",
			label: "Tasks",
			content: (
				<div className="space-y-3">
					{/* Tasks List */}
					{tasks.length ? (
						<div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
							{featureId ? (
								<SortableTaskList
									tasks={tasks}
									featureId={featureId}
									onReorder={handleReorderTasks}
									onDelete={isReadOnlyPending ? undefined : onDeleteTask}
									onClick={onSelectTask}
									onToggleComplete={(taskId) => {
										if (isReadOnlyPending) return;
										const taskToUpdate = tasks.find((t) => t.id === taskId);
										if (!taskToUpdate || !onUpdateTask) return;
										void Promise.resolve(
											onUpdateTask({
												...taskToUpdate,
												status:
													taskToUpdate.status === "done" ? "todo" : "done",
											}),
										).catch(() => undefined);
									}}
									onUpdateStatus={(taskId, status) => {
										if (isReadOnlyPending) return;
										const taskToUpdate = tasks.find((t) => t.id === taskId);
										if (!taskToUpdate || !onUpdateTask) return;
										void Promise.resolve(
											onUpdateTask({ ...taskToUpdate, status }),
										).catch(() => undefined);
									}}
								/>
							) : null}
						</div>
					) : (
						<div className="text-center py-8">
							<p className="text-sm text-gray-600">No tasks yet.</p>
							<p className="text-xs text-gray-500">
								Add tasks to see them here.
							</p>
						</div>
					)}

					{/* Add Task Button */}
					{onAddTask && featureId && (
						<button
							type="button"
							onClick={() => {
								if (isReadOnlyPending) return;
								onAddTask(featureId);
							}}
							disabled={isReadOnlyPending}
							className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg font-medium text-sm transition-colors mt-4"
						>
							<Plus className="w-4 h-4" />
							Add Task
						</button>
					)}
				</div>
			),
		},
	];

	const dateActionButton = !hasDates ? (
		<button
			type="button"
			onClick={openDateMenu}
			disabled={isReadOnlyPending}
			className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
		>
			<Calendar className="w-4 h-4" />
			Dates
		</button>
	) : null;

	return (
		<>
			<RoadmapModalLayout
				isOpen={isOpen}
				onClose={handleRequestClose}
				isReadOnly={isReadOnlyPending}
				title={title}
				onTitleChange={setTitle}
				titlePlaceholder="Feature title"
				onSubmit={handleSubmit}
				actionButtons={dateActionButton}
				showDefaultDatesAction={false}
				body={body}
				footer={footer}
				canComment={Boolean(user) && !isReadOnlyPending}
				rightPanelTabs={rightPanelTabs}
				defaultRightPanelTabId="comments"
			/>
			<UnsavedChangesConfirmModal
				isOpen={isOpen && showUnsavedChangesConfirm}
				isSaving={isLoading}
				isSaveDisabled={!title.trim()}
				entityLabel="feature"
				onCancel={() => setShowUnsavedChangesConfirm(false)}
				onDiscard={handleDiscardChanges}
				onSave={handleSaveBeforeClose}
			/>
		</>
	);
};
