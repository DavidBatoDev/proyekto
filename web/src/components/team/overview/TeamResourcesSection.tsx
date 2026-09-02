import {
	DndContext,
	type DragEndEvent,
	type DragStartEvent,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	rectSortingStrategy,
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ExternalLink,
	Folder,
	FolderOpen,
	GripVertical,
	Loader2,
	Pencil,
	Plus,
	Trash2,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { LinkFavicon } from "@/components/resources/LinkFavicon";
import { ResourceModal } from "@/components/resources/ResourceModal";
import {
	DEFAULT_FOLDER_COLOR,
	DEFAULT_FOLDER_ICON,
	folderColorOf,
	folderIconOf,
	RESOURCE_FOLDER_COLORS,
	RESOURCE_FOLDER_ICONS,
	UNCATEGORIZED_ID,
} from "@/components/resources/resourceTokens";
import { useToast } from "@/hooks/useToast";
import { teamKeys } from "@/queries/teams";
import {
	createTeamResourceFolder,
	createTeamResourceLink,
	deleteTeamResourceFolder,
	deleteTeamResourceLink,
	getTeamResources,
	reorderTeamResourceFolders,
	reorderTeamResourceLinks,
	type TeamResourceFolder,
	type TeamResourceLink,
	type TeamResourcesPayload,
	updateTeamResourceFolder,
	updateTeamResourceLink,
} from "@/services/team-resources.service";

/**
 * The team's shared links, on the Overview tab.
 *
 * Same visual grammar as the project Resources page — folder cards with an
 * accent border, link rows with favicons, drag to reorder — but scoped to a
 * team and read-only for plain members.
 *
 * Positions are contiguous per container and enforced by partial UNIQUE indexes
 * in Postgres, so the API rejects a reorder payload that does not restate the
 * whole container. The drag handler below therefore always sends every item.
 */

type DragKind = { type: "folder" } | { type: "link"; folderId: string | null };

function SortableShell({
	id,
	data,
	className,
	style,
	disabled,
	children,
}: {
	id: string;
	data: Record<string, unknown>;
	className?: string;
	style?: CSSProperties;
	disabled?: boolean;
	children: (handle: ReactNode) => ReactNode;
}) {
	const { attributes, listeners, setNodeRef, transform, isDragging } =
		useSortable({ id, data, disabled });

	const handle = disabled ? null : (
		<div
			{...attributes}
			{...listeners}
			onClick={(event) => event.stopPropagation()}
			title="Drag to reorder"
			className="inline-flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing"
		>
			<GripVertical className="h-3.5 w-3.5" />
		</div>
	);

	return (
		<div
			ref={setNodeRef}
			style={{
				transform: CSS.Translate.toString(transform),
				transition: "none",
				opacity: isDragging ? 0.4 : 1,
				...style,
			}}
			className={className}
		>
			{children(handle)}
		</div>
	);
}

/**
 * A ghost of the real folder card: the accent top border, an icon chip beside
 * the folder name, and a couple of link rows. Three of them are fanned behind
 * the empty-state copy, the same grammar the Projects and Members tabs use, so
 * a blank team reads as one family rather than three unrelated blank pages.
 */
function GhostFolderCard({ className }: { className?: string }) {
	return (
		<div
			aria-hidden
			className={`flex h-24 w-40 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm ${className ?? ""}`}
		>
			<div className="h-1 w-full shrink-0 bg-primary/40" />
			<div className="flex flex-1 flex-col gap-2 p-2.5">
				<div className="flex items-center gap-1.5">
					<span className="h-4 w-4 shrink-0 rounded bg-muted-foreground/20" />
					<span className="h-2 w-1/2 rounded-full bg-muted-foreground/25" />
				</div>
				{[0, 1].map((row) => (
					<div key={row} className="flex items-center gap-1.5">
						<span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-muted-foreground/20" />
						<span
							className={`h-1.5 rounded-full bg-muted-foreground/15 ${
								row === 0 ? "w-3/4" : "w-2/3"
							}`}
						/>
					</div>
				))}
			</div>
		</div>
	);
}

export function TeamResourcesSection({
	teamId,
	canEdit,
}: {
	teamId: string;
	canEdit: boolean;
}) {
	const toast = useToast();
	const queryClient = useQueryClient();

	const query = useQuery({
		queryKey: teamKeys.resources(teamId),
		queryFn: () => getTeamResources(teamId),
		staleTime: 30_000,
	});

	// A local mirror so a drag lands instantly and a failure can roll back to a
	// known-good snapshot without waiting for a refetch.
	const [draft, setDraft] = useState<TeamResourcesPayload | null>(null);
	const payload: TeamResourcesPayload = draft ??
		query.data ?? { folders: [], uncategorized_links: [] };

	const [activeDrag, setActiveDrag] = useState<DragKind | null>(null);
	const [folderModal, setFolderModal] = useState<
		{ mode: "create" } | { mode: "edit"; folder: TeamResourceFolder } | null
	>(null);
	const [linkModal, setLinkModal] = useState<
		| { mode: "create"; folderId: string | null }
		| { mode: "edit"; link: TeamResourceLink }
		| null
	>(null);

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: teamKeys.resources(teamId) });

	// Resource writes touch only this collection. Invalidating the whole
	// ["teams"] prefix here would refetch members, projects, invites and one
	// curated-members query per attached project on every link edit.
	const refresh = async () => {
		setDraft(null);
		await invalidate();
	};

	const mutating = useMutation({
		mutationFn: async (run: () => Promise<unknown>) => run(),
		onSuccess: () => void refresh(),
		onError: (err) => {
			setDraft(null);
			void invalidate();
			toast.error((err as Error).message);
		},
	});

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 150, tolerance: 5 },
		}),
		useSensor(KeyboardSensor),
	);

	const folderCards = useMemo(
		() => payload.folders.slice().sort((a, b) => a.position - b.position),
		[payload.folders],
	);

	const handleDragStart = (event: DragStartEvent) => {
		const data = event.active.data.current as DragKind | undefined;
		setActiveDrag(data ?? null);
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		setActiveDrag(null);
		if (!over || active.id === over.id) return;

		const activeData = active.data.current as DragKind | undefined;
		const overData = over.data.current as DragKind | undefined;
		if (!activeData || !overData || activeData.type !== overData.type) return;

		const snapshot = payload;

		if (activeData.type === "folder") {
			const ids = folderCards.map((folder) => folder.id);
			const from = ids.indexOf(String(active.id));
			const to = ids.indexOf(String(over.id));
			if (from < 0 || to < 0) return;

			const next = [...folderCards];
			const [moved] = next.splice(from, 1);
			next.splice(to, 0, moved);
			const repositioned = next.map((folder, index) => ({
				...folder,
				position: index,
			}));
			setDraft({ ...payload, folders: repositioned });

			mutating.mutate(() =>
				reorderTeamResourceFolders(
					teamId,
					repositioned.map((folder, index) => ({
						id: folder.id,
						position: index,
					})),
				).catch((err) => {
					setDraft(snapshot);
					throw err;
				}),
			);
			return;
		}

		// Links only reorder within their own container; moving between folders is
		// done from the link's edit dialog, where the destination is explicit.
		// (`activeData.type !== overData.type` above rules out the folder variant,
		// but does not narrow `overData` for the compiler.)
		if (overData.type !== "link") return;
		if (activeData.folderId !== overData.folderId) return;
		const folderId = activeData.folderId;
		const container =
			folderId === null
				? payload.uncategorized_links
				: (payload.folders.find((f) => f.id === folderId)?.links ?? []);

		const ids = container.map((link) => link.id);
		const from = ids.indexOf(String(active.id));
		const to = ids.indexOf(String(over.id));
		if (from < 0 || to < 0) return;

		const next = [...container];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		const repositioned = next.map((link, index) => ({
			...link,
			position: index,
		}));

		setDraft(
			folderId === null
				? { ...payload, uncategorized_links: repositioned }
				: {
						...payload,
						folders: payload.folders.map((folder) =>
							folder.id === folderId
								? { ...folder, links: repositioned }
								: folder,
						),
					},
		);

		mutating.mutate(() =>
			reorderTeamResourceLinks(teamId, {
				folder_id: folderId,
				items: repositioned.map((link, index) => ({
					id: link.id,
					position: index,
				})),
			}).catch((err) => {
				setDraft(snapshot);
				throw err;
			}),
		);
	};

	const totalLinks =
		payload.uncategorized_links.length +
		payload.folders.reduce((sum, folder) => sum + folder.links.length, 0);

	if (query.isLoading) {
		return (
			<section className="flex h-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-card p-4">
				<SectionHeader canEdit={false} />
				<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
					<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					Loading resources…
				</div>
			</section>
		);
	}

	if (query.error) {
		return (
			<section className="flex h-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-card p-4">
				<SectionHeader canEdit={false} />
				<p className="min-h-0 flex-1 overflow-y-auto text-sm text-rose-700">
					{(query.error as Error).message}
				</p>
			</section>
		);
	}

	const isEmpty = folderCards.length === 0 && totalLinks === 0;

	return (
		// A fixed height rather than min/max: the card is one of two columns on
		// the Overview, and letting it grow with its content would push the
		// properties rail's sticky position around every time a link is added.
		// The header stays put; only the board below it scrolls.
		<section className="flex h-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-card p-4">
			<SectionHeader
				canEdit={canEdit}
				onNewFolder={() => setFolderModal({ mode: "create" })}
				onAddLink={() => setLinkModal({ mode: "create", folderId: null })}
			/>

			<div className="thin-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
				{isEmpty ? (
					<div className="px-6 py-10 text-center">
						<div className="relative mx-auto mb-6 flex h-28 w-64 items-end justify-center">
							<GhostFolderCard className="absolute bottom-2 left-0 -rotate-6 opacity-45" />
							<GhostFolderCard className="absolute bottom-2 right-0 rotate-6 opacity-45" />
							<GhostFolderCard className="relative z-10 shadow-md" />
						</div>
						<h4 className="text-base font-semibold text-foreground">
							No resources yet
						</h4>
						<p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
							{canEdit
								? "Keep the links this team works out of here — the handbook, the design file, the shared drive."
								: "The team owner and admins can add shared links here."}
						</p>
						{canEdit && (
							<button
								type="button"
								onClick={() => setLinkModal({ mode: "create", folderId: null })}
								className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
							>
								<Plus className="h-4 w-4" />
								Add link
							</button>
						)}
					</div>
				) : (
					<DndContext
						sensors={sensors}
						onDragStart={handleDragStart}
						onDragEnd={handleDragEnd}
						onDragCancel={() => setActiveDrag(null)}
					>
						<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
							{payload.uncategorized_links.length > 0 && (
								<FolderCard
									key={UNCATEGORIZED_ID}
									folder={null}
									links={payload.uncategorized_links}
									canEdit={canEdit}
									draggingFolders={activeDrag?.type === "folder"}
									onAddLink={() =>
										setLinkModal({ mode: "create", folderId: null })
									}
									onEditLink={(link) => setLinkModal({ mode: "edit", link })}
									onDeleteLink={(link) =>
										mutating.mutate(() =>
											deleteTeamResourceLink(teamId, link.id),
										)
									}
								/>
							)}

							<SortableContext
								items={folderCards.map((folder) => folder.id)}
								strategy={rectSortingStrategy}
								disabled={!canEdit}
							>
								{folderCards.map((folder) => (
									<SortableShell
										key={folder.id}
										id={folder.id}
										data={{ type: "folder" }}
										disabled={!canEdit}
										style={{
											// Inline, because `.app-surface-card` sets a `border`
											// shorthand that outranks Tailwind's border utilities.
											borderTopWidth: 4,
											borderTopColor: folderColorOf(folder.color).accent,
										}}
										className="rounded-xl"
									>
										{(handle) => (
											<FolderCard
												folder={folder}
												links={folder.links}
												canEdit={canEdit}
												handle={handle}
												draggingFolders={activeDrag?.type === "folder"}
												onEdit={() => setFolderModal({ mode: "edit", folder })}
												onDelete={() =>
													mutating.mutate(() =>
														deleteTeamResourceFolder(teamId, folder.id),
													)
												}
												onAddLink={() =>
													setLinkModal({ mode: "create", folderId: folder.id })
												}
												onEditLink={(link) =>
													setLinkModal({ mode: "edit", link })
												}
												onDeleteLink={(link) =>
													mutating.mutate(() =>
														deleteTeamResourceLink(teamId, link.id),
													)
												}
											/>
										)}
									</SortableShell>
								))}
							</SortableContext>
						</div>
					</DndContext>
				)}
			</div>

			{folderModal && (
				<FolderFormModal
					initial={folderModal.mode === "edit" ? folderModal.folder : null}
					busy={mutating.isPending}
					onClose={() => setFolderModal(null)}
					onSubmit={(values) => {
						setFolderModal(null);
						mutating.mutate(() =>
							folderModal.mode === "edit"
								? updateTeamResourceFolder(
										teamId,
										folderModal.folder.id,
										values,
									)
								: createTeamResourceFolder(teamId, values),
						);
					}}
				/>
			)}

			{linkModal && (
				<LinkFormModal
					initial={linkModal.mode === "edit" ? linkModal.link : null}
					defaultFolderId={
						linkModal.mode === "create" ? linkModal.folderId : null
					}
					folders={folderCards}
					busy={mutating.isPending}
					onClose={() => setLinkModal(null)}
					onSubmit={(values) => {
						setLinkModal(null);
						mutating.mutate(() =>
							linkModal.mode === "edit"
								? updateTeamResourceLink(teamId, linkModal.link.id, values)
								: createTeamResourceLink(teamId, values),
						);
					}}
				/>
			)}
		</section>
	);
}

function SectionHeader({
	canEdit,
	onNewFolder,
	onAddLink,
}: {
	canEdit: boolean;
	onNewFolder?: () => void;
	onAddLink?: () => void;
}) {
	return (
		<div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
			<h2 className="text-[15px] font-semibold text-foreground">
				Team Resources
			</h2>
			{canEdit && (
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onNewFolder}
						className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
					>
						<Folder className="h-3.5 w-3.5" />
						New folder
					</button>
					<button
						type="button"
						onClick={onAddLink}
						className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
					>
						<Plus className="h-3.5 w-3.5" />
						Add link
					</button>
				</div>
			)}
		</div>
	);
}

/** `folder === null` renders the synthetic Uncategorized bucket. */
function FolderCard({
	folder,
	links,
	canEdit,
	handle,
	draggingFolders,
	onEdit,
	onDelete,
	onAddLink,
	onEditLink,
	onDeleteLink,
}: {
	folder: TeamResourceFolder | null;
	links: TeamResourceLink[];
	canEdit: boolean;
	handle?: ReactNode;
	draggingFolders: boolean;
	onEdit?: () => void;
	onDelete?: () => void;
	onAddLink: () => void;
	onEditLink: (link: TeamResourceLink) => void;
	onDeleteLink: (link: TeamResourceLink) => void;
}) {
	const Icon = folder ? folderIconOf(folder.icon) : FolderOpen;
	const folderId = folder?.id ?? null;
	const sorted = links.slice().sort((a, b) => a.position - b.position);

	return (
		<div className="group/folder rounded-xl border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md">
			<div className="mb-2 flex items-start gap-2 rounded-lg bg-muted/50 px-2.5 py-2">
				{handle}
				<span className="mt-0.5 rounded-md bg-muted p-1.5">
					<Icon className="h-3.5 w-3.5 text-foreground" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-semibold text-foreground">
						{folder ? folder.name : "Uncategorized"}
					</span>
					<span className="block text-[11px] text-muted-foreground">
						{sorted.length} {sorted.length === 1 ? "link" : "links"}
					</span>
				</span>
				{canEdit && (
					<span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/folder:opacity-100 focus-within:opacity-100">
						{folder && (
							<>
								<button
									type="button"
									onClick={onEdit}
									aria-label={`Edit ${folder.name}`}
									className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
								>
									<Pencil className="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									onClick={() => {
										if (
											window.confirm(
												`Delete "${folder.name}"? Its links move to Uncategorized.`,
											)
										) {
											onDelete?.();
										}
									}}
									aria-label={`Delete ${folder.name}`}
									className="rounded p-1 text-muted-foreground hover:bg-rose-50 hover:text-rose-700"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</button>
							</>
						)}
						<button
							type="button"
							onClick={onAddLink}
							className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
							aria-label="Add a link to this folder"
						>
							<Plus className="h-3.5 w-3.5" />
						</button>
					</span>
				)}
			</div>

			{sorted.length === 0 ? (
				<p className="rounded-lg bg-muted/40 px-3 py-6 text-center text-xs text-muted-foreground">
					No links yet
				</p>
			) : (
				<SortableContext
					items={sorted.map((link) => link.id)}
					strategy={verticalListSortingStrategy}
					// A folder drag must not leave the link droppables competing for
					// the collision pass — that is what makes a board of many folders
					// feel heavy.
					disabled={!canEdit || draggingFolders}
				>
					<ul className="space-y-1.5">
						{sorted.map((link) => (
							<li key={link.id}>
								<SortableShell
									id={link.id}
									data={{ type: "link", folderId }}
									disabled={!canEdit || draggingFolders}
								>
									{(linkHandle) => (
										<LinkRow
											link={link}
											handle={linkHandle}
											canEdit={canEdit}
											onEdit={() => onEditLink(link)}
											onDelete={() => {
												if (window.confirm(`Delete "${link.title}"?`)) {
													onDeleteLink(link);
												}
											}}
										/>
									)}
								</SortableShell>
							</li>
						))}
					</ul>
				</SortableContext>
			)}
		</div>
	);
}

function LinkRow({
	link,
	handle,
	canEdit,
	onEdit,
	onDelete,
}: {
	link: TeamResourceLink;
	handle: ReactNode;
	canEdit: boolean;
	onEdit: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="group/link flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
			{handle}
			<LinkFavicon url={link.url} />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-xs font-semibold text-foreground">
					{link.title}
				</span>
				<span
					className="block truncate text-[11px] text-muted-foreground"
					title={link.url}
				>
					{link.url}
				</span>
			</span>
			<span className="flex shrink-0 items-center gap-0.5">
				{canEdit && (
					<span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/link:opacity-100 focus-within:opacity-100">
						<button
							type="button"
							onClick={onEdit}
							aria-label={`Edit ${link.title}`}
							className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							<Pencil className="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							onClick={onDelete}
							aria-label={`Delete ${link.title}`}
							className="rounded p-1 text-muted-foreground hover:bg-rose-50 hover:text-rose-700"
						>
							<Trash2 className="h-3.5 w-3.5" />
						</button>
					</span>
				)}
				<a
					href={link.url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`Open ${link.title}`}
					className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					<ExternalLink className="h-3.5 w-3.5" />
				</a>
			</span>
		</div>
	);
}

function FolderFormModal({
	initial,
	busy,
	onClose,
	onSubmit,
}: {
	initial: TeamResourceFolder | null;
	busy: boolean;
	onClose: () => void;
	onSubmit: (values: { name: string; icon: string; color: string }) => void;
}) {
	const [name, setName] = useState(initial?.name ?? "");
	const [icon, setIcon] = useState(initial?.icon ?? DEFAULT_FOLDER_ICON);
	const [color, setColor] = useState(initial?.color ?? DEFAULT_FOLDER_COLOR);
	const trimmed = name.trim();

	return (
		<ResourceModal
			title={initial ? "Edit folder" : "New folder"}
			onClose={onClose}
		>
			<label className="block text-xs font-semibold text-muted-foreground">
				Folder name
				<input
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="Design references"
					maxLength={120}
					autoFocus
					className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
				/>
			</label>

			<fieldset className="mt-4">
				<legend className="text-xs font-semibold text-muted-foreground">
					Colour
				</legend>
				<div className="mt-1.5 flex flex-wrap gap-1.5">
					{RESOURCE_FOLDER_COLORS.map((entry) => (
						<button
							key={entry.token}
							type="button"
							aria-label={entry.label}
							aria-pressed={color === entry.token}
							onClick={() => setColor(entry.token)}
							className={`h-7 w-7 rounded-md ${entry.swatch} ${
								color === entry.token
									? "ring-2 ring-foreground ring-offset-2"
									: ""
							}`}
						/>
					))}
				</div>
			</fieldset>

			<fieldset className="mt-4">
				<legend className="text-xs font-semibold text-muted-foreground">
					Icon
				</legend>
				<div className="mt-1.5 grid grid-cols-8 gap-1.5">
					{RESOURCE_FOLDER_ICONS.map((entry) => {
						const Icon = entry.Icon;
						return (
							<button
								key={entry.token}
								type="button"
								aria-label={entry.token}
								aria-pressed={icon === entry.token}
								onClick={() => setIcon(entry.token)}
								className={`flex h-8 items-center justify-center rounded-md border border-border ${
									icon === entry.token
										? "bg-foreground text-background"
										: "bg-card text-muted-foreground hover:bg-muted"
								}`}
							>
								<Icon className="h-3.5 w-3.5" />
							</button>
						);
					})}
				</div>
			</fieldset>

			<div className="mt-5 flex items-center justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted"
				>
					Cancel
				</button>
				<button
					type="button"
					disabled={!trimmed || busy}
					onClick={() => onSubmit({ name: trimmed, icon, color })}
					className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
					Save
				</button>
			</div>
		</ResourceModal>
	);
}

function LinkFormModal({
	initial,
	defaultFolderId,
	folders,
	busy,
	onClose,
	onSubmit,
}: {
	initial: TeamResourceLink | null;
	defaultFolderId: string | null;
	folders: TeamResourceFolder[];
	busy: boolean;
	onClose: () => void;
	onSubmit: (values: {
		title: string;
		url: string;
		description?: string;
		folder_id: string | null;
	}) => void;
}) {
	const [title, setTitle] = useState(initial?.title ?? "");
	const [url, setUrl] = useState(initial?.url ?? "");
	const [description, setDescription] = useState(initial?.description ?? "");
	const [folderId, setFolderId] = useState<string>(
		initial?.folder_id ?? defaultFolderId ?? "",
	);

	const trimmedTitle = title.trim();
	const trimmedUrl = url.trim();
	const valid = trimmedTitle.length > 0 && /^https?:\/\//i.test(trimmedUrl);

	return (
		<ResourceModal title={initial ? "Edit link" : "Add link"} onClose={onClose}>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<label className="block text-xs font-semibold text-muted-foreground">
					Title
					<input
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder="Team handbook"
						maxLength={255}
						autoFocus
						className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
					/>
				</label>
				<label className="block text-xs font-semibold text-muted-foreground">
					Folder
					<select
						value={folderId}
						onChange={(event) => setFolderId(event.target.value)}
						className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
					>
						<option value="">Uncategorized</option>
						{folders.map((folder) => (
							<option key={folder.id} value={folder.id}>
								{folder.name}
							</option>
						))}
					</select>
				</label>
			</div>

			<label className="mt-3 block text-xs font-semibold text-muted-foreground">
				URL
				<span className="mt-1 flex items-center gap-2 rounded-full border border-border bg-muted px-2 py-1 focus-within:bg-card">
					<LinkFavicon url={trimmedUrl} />
					<input
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						placeholder="https://…"
						spellCheck={false}
						autoComplete="off"
						maxLength={2048}
						className="min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none"
					/>
				</span>
			</label>

			<label className="mt-3 block text-xs font-semibold text-muted-foreground">
				Description (optional)
				<textarea
					value={description ?? ""}
					onChange={(event) => setDescription(event.target.value)}
					rows={2}
					maxLength={2000}
					className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
				/>
			</label>

			<div className="mt-5 flex items-center justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted"
				>
					Cancel
				</button>
				<button
					type="button"
					disabled={!valid || busy}
					onClick={() =>
						onSubmit({
							title: trimmedTitle,
							url: trimmedUrl,
							description: description?.trim() || undefined,
							folder_id: folderId || null,
						})
					}
					className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
					Save
				</button>
			</div>
		</ResourceModal>
	);
}
