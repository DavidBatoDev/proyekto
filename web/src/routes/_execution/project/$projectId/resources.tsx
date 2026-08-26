import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	rectSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createFileRoute } from "@tanstack/react-router";
import {
	BookOpen,
	Bot,
	Box,
	Braces,
	Briefcase,
	Building2,
	ChevronDown,
	Code2,
	Copy,
	Cpu,
	Database,
	ExternalLink,
	FileText,
	Folder,
	FolderOpen,
	Gauge,
	Globe,
	GripVertical,
	Layers,
	Link2,
	Loader2,
	type LucideIcon,
	Maximize2,
	Package,
	Palette,
	Pencil,
	Plus,
	Rocket,
	Search,
	Server,
	SlidersHorizontal,
	Sparkles,
	Terminal,
	Trash2,
	Wrench,
} from "lucide-react";
import {
	type CSSProperties,
	memo,
	type ReactNode,
	useEffect,
	useMemo,
	useState,
} from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import {
	useInvalidateProjectQueries,
	useProjectResourcesQuery,
} from "@/hooks/useProjectQueries";
import { useToast } from "@/hooks/useToast";
import {
	type ProjectResourceFolder,
	type ProjectResourceLink,
	type ProjectResourcesPayload,
	projectService,
} from "@/services/project.service";

export const Route = createFileRoute(
	"/_execution/project/$projectId/resources",
)({
	// `?folder=<id>` opens that folder in a modal, so folder views are shareable.
	validateSearch: (search: Record<string, unknown>): ResourcesSearch => ({
		folder:
			typeof search.folder === "string" && search.folder.trim().length > 0
				? search.folder
				: undefined,
	}),
	component: ResourcesRoute,
});

type ResourcesSearch = {
	folder?: string;
};

/**
 * Folder decoration. Icons and colours are stored as short tokens (see the
 * matching lists in the backend DTO), so the palette lives here in the UI and
 * adding one is a deploy rather than a migration. Colour classes are spelled
 * out rather than built by interpolation — Tailwind only ships classes it can
 * see in the source.
 */
const RESOURCE_FOLDER_ICONS: { token: string; Icon: LucideIcon }[] = [
	{ token: "folder", Icon: Folder },
	{ token: "code", Icon: Code2 },
	{ token: "terminal", Icon: Terminal },
	{ token: "bot", Icon: Bot },
	{ token: "package", Icon: Package },
	{ token: "database", Icon: Database },
	{ token: "globe", Icon: Globe },
	{ token: "server", Icon: Server },
	{ token: "cpu", Icon: Cpu },
	{ token: "layers", Icon: Layers },
	{ token: "braces", Icon: Braces },
	{ token: "rocket", Icon: Rocket },
	{ token: "wrench", Icon: Wrench },
	{ token: "briefcase", Icon: Briefcase },
	{ token: "building", Icon: Building2 },
	{ token: "palette", Icon: Palette },
	{ token: "gauge", Icon: Gauge },
	{ token: "sparkles", Icon: Sparkles },
	{ token: "file-text", Icon: FileText },
	{ token: "box", Icon: Box },
];

const RESOURCE_FOLDER_COLORS: {
	token: string;
	label: string;
	/** Swatch in the picker. */
	swatch: string;
	/** The card's top border — the thing that makes a folder findable. It is
	 *  applied inline because `.app-surface-card` sets a `border` shorthand that
	 *  outranks Tailwind's border utilities. */
	accent: string;
}[] = [
	{
		token: "white",
		label: "None",
		swatch: "bg-white border border-slate-300",
		accent: "var(--color-white)",
	},
	{
		token: "slate",
		label: "Slate",
		swatch: "bg-slate-400",
		accent: "var(--color-slate-400)",
	},
	{
		token: "red",
		label: "Red",
		swatch: "bg-red-500",
		accent: "var(--color-red-500)",
	},
	{
		token: "orange",
		label: "Orange",
		swatch: "bg-orange-500",
		accent: "var(--color-orange-500)",
	},
	{
		token: "amber",
		label: "Amber",
		swatch: "bg-amber-500",
		accent: "var(--color-amber-500)",
	},
	{
		token: "green",
		label: "Green",
		swatch: "bg-green-500",
		accent: "var(--color-green-500)",
	},
	{
		token: "teal",
		label: "Teal",
		swatch: "bg-teal-500",
		accent: "var(--color-teal-500)",
	},
	{
		token: "blue",
		label: "Blue",
		swatch: "bg-blue-600",
		accent: "var(--color-blue-600)",
	},
	{
		token: "violet",
		label: "Violet",
		swatch: "bg-violet-500",
		accent: "var(--color-violet-500)",
	},
	{
		token: "pink",
		label: "Pink",
		swatch: "bg-pink-500",
		accent: "var(--color-pink-500)",
	},
];

const DEFAULT_FOLDER_ICON = "folder";
const DEFAULT_FOLDER_COLOR = "white";

function folderIconOf(token: string | undefined): LucideIcon {
	return (
		RESOURCE_FOLDER_ICONS.find((entry) => entry.token === token)?.Icon ?? Folder
	);
}

function folderColorOf(token: string | undefined) {
	return (
		RESOURCE_FOLDER_COLORS.find((entry) => entry.token === token) ??
		RESOURCE_FOLDER_COLORS[0]
	);
}

/** Sentinel folder id for the synthetic "Uncategorized" bucket. */
const UNCATEGORIZED_ID = "uncategorized";

function ResourcesRoute() {
	const { projectId } = Route.useParams();
	return (
		<RequireProjectAccess projectId={projectId} access="resources">
			<ResourcesPage />
		</RequireProjectAccess>
	);
}

type LinkFormState = {
	id?: string;
	title: string;
	url: string;
	description: string;
	folder_id: string;
};

type FolderFormState = {
	id?: string;
	name: string;
	icon: string;
	color: string;
};

type FolderFilter = "all" | "with_links" | "empty";

const initialPayload: ProjectResourcesPayload = {
	folders: [],
	uncategorized_links: [],
};

/**
 * Hosts whose favicon already failed once this session. Shared across rows so a
 * dead icon is requested once, not once per link (and not again after a
 * re-render or reopening a folder modal).
 */
const failedFaviconHosts = new Set<string>();

function getFaviconHost(url: string): string | null {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
			return null;
		return parsed.hostname;
	} catch {
		return null;
	}
}

/** DuckDuckGo's icon service - no Google request, and CDN-cached per host. */
function getFaviconUrl(host: string): string {
	return `https://icons.duckduckgo.com/ip3/${host}.ico`;
}

/**
 * Small favicon preview for a resource link. Falls back to the generic link
 * glyph when the URL is unparsable or the icon fails to load (offline hosts,
 * blocked third-party requests).
 */
function LinkFavicon({
	url,
	className = "h-3.5 w-3.5",
	wrapperClassName = "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700",
}: {
	url: string;
	className?: string;
	wrapperClassName?: string;
}) {
	const host = getFaviconHost(url);
	// Keyed by host rather than a bare boolean: the omnibox input re-renders this
	// on every keystroke, so a failure for one host must not hide the next one.
	const [failedHost, setFailedHost] = useState<string | null>(null);
	const failed = !host || failedHost === host || failedFaviconHosts.has(host);

	return (
		<div className={wrapperClassName}>
			{host && !failed ? (
				<img
					src={getFaviconUrl(host)}
					alt=""
					loading="lazy"
					decoding="async"
					referrerPolicy="no-referrer"
					onError={() => {
						failedFaviconHosts.add(host);
						setFailedHost(host);
					}}
					className={`${className} rounded-sm object-contain`}
				/>
			) : (
				<Link2 className={className} />
			)}
		</div>
	);
}

/**
 * Drag handle + sortable wrapper, mirroring the roadmap left panel's rows:
 * the whole card/row moves, but only the grip starts a drag so clicks on the
 * title, buttons, and links keep working.
 */
type SortableShellProps = {
	id: string;
	data: Record<string, unknown>;
	className?: string;
	/** Merged after the drag transform — used for the folder accent border. */
	style?: CSSProperties;
	children: (handle: ReactNode) => ReactNode;
};

const SortableShell = memo(function SortableShell({
	id,
	data,
	className,
	style,
	children,
}: SortableShellProps) {
	const { attributes, listeners, setNodeRef, transform, isDragging } =
		useSortable({ id, data });

	const handle = (
		<div
			{...attributes}
			{...listeners}
			onClick={(event) => event.stopPropagation()}
			className="inline-flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
			title="Drag to reorder"
		>
			<GripVertical className="h-3.5 w-3.5" />
		</div>
	);

	return (
		<div
			ref={setNodeRef}
			style={{
				// Same trade the kanban board makes: translate only, and no reorder
				// animation. Cards snap straight into their new slot instead of
				// sliding, so a heavy card's subtree is never re-composited frame by
				// frame while the pointer moves.
				transform: CSS.Translate.toString(transform),
				transition: "none",
				// The dragged card is drawn by the DragOverlay instead; what stays
				// behind is just a slot placeholder.
				opacity: isDragging ? 0.4 : 1,
				...style,
			}}
			className={className}
		>
			{children(handle)}
		</div>
	);
});

function ResourceModal({
	title,
	onClose,
	children,
	headerExtra,
	maxWidthClass = "max-w-lg",
}: {
	title: string;
	onClose: () => void;
	children: React.ReactNode;
	headerExtra?: React.ReactNode;
	maxWidthClass?: string;
}) {
	return (
		<ModalPortal>
			<div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/35 backdrop-blur-sm p-4">
				<div
					className={`w-full ${maxWidthClass} overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_48px_rgba(15,23,42,0.2)]`}
				>
					<div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-3">
						<h3 className="min-w-0 truncate text-base font-semibold text-slate-900">
							{title}
						</h3>
						{headerExtra}
						<button
							type="button"
							onClick={onClose}
							className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-200"
						>
							<ChevronDown className="h-4 w-4 rotate-90" />
						</button>
					</div>
					<div className="p-4">{children}</div>
				</div>
			</div>
		</ModalPortal>
	);
}

function ResourcesSkeleton() {
	return (
		<div className="space-y-6 animate-pulse">
			<section className="app-surface-card p-4">
				<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
					<div className="h-4 w-32 rounded bg-gray-200" />
					<div className="flex gap-2">
						<div className="h-9 w-72 rounded-lg bg-gray-200" />
						<div className="h-9 w-40 rounded-lg bg-gray-200" />
					</div>
				</div>
			</section>
			<section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
				{Array.from({ length: 6 }).map((_, index) => (
					<div
						key={`resources-skeleton-${index}`}
						className="min-h-[320px] app-surface-card p-4"
					>
						<div className="mb-4 flex items-center justify-between">
							<div className="space-y-2">
								<div className="h-4 w-32 rounded bg-gray-200" />
								<div className="h-3 w-20 rounded bg-slate-100" />
							</div>
							<div className="h-8 w-16 rounded-md bg-slate-100" />
						</div>
						<div className="space-y-2">
							<div className="h-12 rounded-lg bg-slate-100" />
							<div className="h-12 rounded-lg bg-slate-100" />
							<div className="h-12 rounded-lg bg-slate-100" />
						</div>
					</div>
				))}
			</section>
		</div>
	);
}

function ResourcesPage() {
	const { projectId } = Route.useParams();
	const { folder: openFolderId } = Route.useSearch();
	const navigate = Route.useNavigate();
	const toast = useToast();
	const resourcesQuery = useProjectResourcesQuery(projectId);
	const { invalidateResources } = useInvalidateProjectQueries(projectId);

	const [resources, setResources] =
		useState<ProjectResourcesPayload>(initialPayload);
	const [isBusy, setIsBusy] = useState(false);

	const [folderForm, setFolderForm] = useState<FolderFormState | null>(null);
	const [linkForm, setLinkForm] = useState<LinkFormState | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");

	const totalLinks =
		(resources.uncategorized_links?.length ?? 0) +
		(resources.folders ?? []).reduce(
			(sum, folder) => sum + (folder.links?.length ?? 0),
			0,
		);

	const totalFolders = resources.folders?.length ?? 0;

	const folderOptions = useMemo(
		() =>
			(resources.folders ?? []).map((folder) => ({
				id: folder.id,
				name: folder.name,
			})),
		[resources.folders],
	);

	const normalizedSearch = searchQuery.trim().toLowerCase();

	const linkMatchesSearch = (link: ProjectResourceLink) => {
		if (!normalizedSearch) return true;
		const haystack =
			`${link.title} ${link.url} ${link.description ?? ""}`.toLowerCase();
		return haystack.includes(normalizedSearch);
	};

	const folderCards = (resources.folders ?? [])
		.map((folder) => {
			const allLinks = folder.links ?? [];
			const folderNameMatch = folder.name
				.toLowerCase()
				.includes(normalizedSearch);
			const matchedLinks = allLinks.filter(linkMatchesSearch);
			const displayedLinks = normalizedSearch
				? folderNameMatch
					? allLinks
					: matchedLinks
				: allLinks;

			const matchesSearch =
				!normalizedSearch || folderNameMatch || matchedLinks.length > 0;

			return {
				folder,
				displayedLinks,
				matchesSearch,
			};
		})
		.filter((entry) => {
			if (!entry.matchesSearch) return false;
			if (folderFilter === "with_links") return entry.displayedLinks.length > 0;
			if (folderFilter === "empty") return entry.displayedLinks.length === 0;
			return true;
		});

	const uncategorizedDisplayedLinks = (
		resources.uncategorized_links ?? []
	).filter(linkMatchesSearch);
	const showUncategorizedCard = uncategorizedDisplayedLinks.length > 0;

	// Dragging is only offered on the unfiltered list: a search or filter hides
	// rows, so a drop index there wouldn't map onto the real positions.
	const canDragFolders = !normalizedSearch && folderFilter === "all";
	const canDragLinks = !normalizedSearch;

	const [activeDrag, setActiveDrag] = useState<{
		id: string;
		type: "folder" | "link";
		folderId: string | null;
	} | null>(null);

	/** What the pointer carries: a light ghost, never the live card. */
	const activeFolder =
		activeDrag?.type === "folder"
			? ((resources.folders ?? []).find((f) => f.id === activeDrag.id) ?? null)
			: null;
	const activeLink =
		activeDrag?.type === "link"
			? ([
					...(resources.uncategorized_links ?? []),
					...(resources.folders ?? []).flatMap((f) => f.links ?? []),
				].find((l) => l.id === activeDrag.id) ?? null)
			: null;

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 150, tolerance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragStart = (event: DragStartEvent) => {
		const data = event.active.data.current as
			| { type?: "folder" | "link"; folderId?: string | null }
			| undefined;
		setActiveDrag({
			id: String(event.active.id),
			type: data?.type === "link" ? "link" : "folder",
			folderId: data?.folderId ?? null,
		});
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		setActiveDrag(null);
		if (!over || active.id === over.id) return;

		const activeData = active.data.current as
			| { type?: "folder" | "link"; folderId?: string | null }
			| undefined;
		const overData = over.data.current as
			| { type?: "folder" | "link"; folderId?: string | null }
			| undefined;
		if (!activeData || !overData || activeData.type !== overData.type) return;

		if (activeData.type === "folder") {
			const current = resources.folders ?? [];
			const from = current.findIndex((f) => f.id === active.id);
			const to = current.findIndex((f) => f.id === over.id);
			if (from < 0 || to < 0) return;
			void reorderFolders(arrayMove(current, from, to));
			return;
		}

		// Links only reorder inside their own folder — moving one between folders
		// is an edit (folder_id change), not a reorder.
		const folderId = activeData.folderId ?? null;
		if ((overData.folderId ?? null) !== folderId) return;
		const current =
			folderId === null
				? (resources.uncategorized_links ?? [])
				: ((resources.folders ?? []).find((f) => f.id === folderId)?.links ??
					[]);
		const from = current.findIndex((l) => l.id === active.id);
		const to = current.findIndex((l) => l.id === over.id);
		if (from < 0 || to < 0) return;
		void reorderLinks(folderId, arrayMove(current, from, to));
	};

	const openFolder = (folderId: string) => {
		void navigate({
			search: (prev: ResourcesSearch) => ({ ...prev, folder: folderId }),
			replace: false,
		});
	};

	const closeFolder = () => {
		void navigate({
			search: (prev: ResourcesSearch) => ({ ...prev, folder: undefined }),
			replace: true,
		});
	};

	const openedFolder = useMemo(() => {
		if (!openFolderId) return null;
		if (openFolderId === UNCATEGORIZED_ID) {
			return {
				id: null as string | null,
				name: "Uncategorized",
				links: resources.uncategorized_links ?? [],
			};
		}
		const match = (resources.folders ?? []).find((f) => f.id === openFolderId);
		if (!match) return null;
		return { id: match.id, name: match.name, links: match.links ?? [] };
	}, [openFolderId, resources]);

	const copyLinkUrl = async (url: string) => {
		try {
			await navigator.clipboard.writeText(url);
			toast.success("Link copied");
		} catch {
			toast.error("Could not copy the link");
		}
	};

	const copyFolderLink = async (folderId: string) => {
		const url = `${window.location.origin}${window.location.pathname}?folder=${encodeURIComponent(folderId)}`;
		try {
			await navigator.clipboard.writeText(url);
			toast.success("Folder link copied");
		} catch {
			toast.error("Could not copy the link");
		}
	};

	useEffect(() => {
		if (resourcesQuery.data) {
			setResources(resourcesQuery.data);
		}
	}, [resourcesQuery.data]);

	useEffect(() => {
		if (!resourcesQuery.error) return;
		toast.error(
			resourcesQuery.error instanceof Error
				? resourcesQuery.error.message
				: "Failed to load resources",
		);
	}, [resourcesQuery.error, toast]);

	const runWithBusy = async (action: () => Promise<void>) => {
		if (isBusy) return;
		setIsBusy(true);
		try {
			await action();
		} finally {
			setIsBusy(false);
		}
	};

	const onSaveFolder = async () => {
		if (!folderForm) return;
		const name = folderForm.name.trim();
		if (!name) {
			toast.error("Folder name is required");
			return;
		}

		await runWithBusy(async () => {
			try {
				const decoration = {
					icon: folderForm.icon,
					color: folderForm.color,
				};
				if (folderForm.id) {
					await projectService.updateResourceFolder(projectId, folderForm.id, {
						name,
						...decoration,
					});
					toast.success("Folder updated");
				} else {
					await projectService.createResourceFolder(projectId, {
						name,
						...decoration,
					});
					toast.success("Folder created");
				}
				setFolderForm(null);
				await invalidateResources();
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Failed to save folder",
				);
			}
		});
	};

	const onDeleteFolder = async (folder: ProjectResourceFolder) => {
		if (
			!confirm(
				`Delete folder \"${folder.name}\"? Links will move to uncategorized.`,
			)
		) {
			return;
		}

		await runWithBusy(async () => {
			try {
				await projectService.deleteResourceFolder(projectId, folder.id);
				toast.success("Folder deleted");
				await invalidateResources();
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Failed to delete folder",
				);
			}
		});
	};

	/**
	 * Reorders are optimistic and deliberately outside `runWithBusy`: the new
	 * order paints on drop and the request settles behind it, so consecutive
	 * drags never wait on the previous round trip. A failure rolls the list back
	 * to the snapshot taken before the drag and refetches the server's truth.
	 */
	const reorderFolders = async (next: ProjectResourceFolder[]) => {
		const snapshot = resources;
		setResources((prev) => ({ ...prev, folders: next }));
		try {
			await projectService.reorderResourceFolders(
				projectId,
				next.map((folder, index) => ({ id: folder.id, position: index })),
			);
		} catch (error) {
			setResources(snapshot);
			toast.error(
				error instanceof Error ? error.message : "Failed to reorder folders",
			);
			await invalidateResources();
		}
	};

	const reorderLinks = async (
		folderId: string | null,
		next: ProjectResourceLink[],
	) => {
		const snapshot = resources;
		if (folderId === null) {
			setResources((prev) => ({ ...prev, uncategorized_links: next }));
		} else {
			setResources((prev) => ({
				...prev,
				folders: prev.folders.map((folder) =>
					folder.id === folderId ? { ...folder, links: next } : folder,
				),
			}));
		}

		try {
			await projectService.reorderResourceLinks(projectId, {
				folder_id: folderId,
				items: next.map((link, index) => ({ id: link.id, position: index })),
			});
		} catch (error) {
			setResources(snapshot);
			toast.error(
				error instanceof Error ? error.message : "Failed to reorder links",
			);
			await invalidateResources();
		}
	};

	const isValidResourceLinkPayload = (
		link: ProjectResourceLink | null | undefined,
	): link is ProjectResourceLink =>
		Boolean(
			link &&
				typeof link.id === "string" &&
				link.id.trim().length > 0 &&
				typeof link.title === "string" &&
				link.title.trim().length > 0 &&
				typeof link.url === "string" &&
				link.url.trim().length > 0,
		);

	const mergeLinkIntoState = (nextLink: ProjectResourceLink): boolean => {
		if (!isValidResourceLinkPayload(nextLink)) {
			toast.error(
				"Invalid link payload received. Please refresh and try again.",
			);
			return false;
		}

		setResources((prev) => {
			const cleanedFolders = (prev.folders ?? []).map((folder) => ({
				...folder,
				links: (folder.links ?? []).filter((link) => link.id !== nextLink.id),
			}));
			const cleanedUncategorized = (prev.uncategorized_links ?? []).filter(
				(link) => link.id !== nextLink.id,
			);

			if (nextLink.folder_id) {
				return {
					...prev,
					uncategorized_links: cleanedUncategorized,
					folders: cleanedFolders.map((folder) =>
						folder.id === nextLink.folder_id
							? {
									...folder,
									links: [...(folder.links ?? []), nextLink].sort(
										(a, b) => a.position - b.position,
									),
								}
							: folder,
					),
				};
			}

			return {
				...prev,
				folders: cleanedFolders,
				uncategorized_links: [...cleanedUncategorized, nextLink].sort(
					(a, b) => a.position - b.position,
				),
			};
		});
		return true;
	};

	const removeLinkFromState = (linkId: string) => {
		setResources((prev) => ({
			...prev,
			uncategorized_links: (prev.uncategorized_links ?? []).filter(
				(link) => link.id !== linkId,
			),
			folders: (prev.folders ?? []).map((folder) => ({
				...folder,
				links: (folder.links ?? []).filter((link) => link.id !== linkId),
			})),
		}));
	};

	const onSaveLink = async () => {
		if (!linkForm) return;

		const title = linkForm.title.trim();
		const url = linkForm.url.trim();
		const description = linkForm.description.trim();
		const folder_id = linkForm.folder_id || null;

		if (!title || !url) {
			toast.error("Link title and URL are required");
			return;
		}

		await runWithBusy(async () => {
			try {
				if (linkForm.id) {
					const updatedLink = await projectService.updateResourceLink(
						projectId,
						linkForm.id,
						{
							title,
							url,
							description: description || undefined,
							folder_id,
						},
					);
					if (mergeLinkIntoState(updatedLink)) {
						toast.success("Link updated");
					}
				} else {
					const createdLink = await projectService.createResourceLink(
						projectId,
						{
							title,
							url,
							description: description || undefined,
							folder_id,
						},
					);
					if (mergeLinkIntoState(createdLink)) {
						toast.success("Link created");
					}
				}

				setLinkForm(null);
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Failed to save link",
				);
			}
		});
	};

	const onDeleteLink = async (link: ProjectResourceLink) => {
		if (!confirm(`Delete link \"${link.title}\"?`)) return;

		await runWithBusy(async () => {
			try {
				await projectService.deleteResourceLink(projectId, link.id);
				removeLinkFromState(link.id);
				toast.success("Link deleted");
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Failed to delete link",
				);
			}
		});
	};

	const renderFolderCardLinks = (
		links: ProjectResourceLink[],
		folderId: string | null,
		/** The modal shows the whole list; cards cap the height and scroll. */
		expanded = false,
	) => {
		// Every link row is a sortable node, so a board with a few full folders
		// registers hundreds of droppables. Keeping the ones that can't receive
		// this drag out of the collision pass is what keeps a folder drag smooth:
		// during a folder drag no link is a target, and during a link drag only
		// its own folder is.
		const linksDraggableHere =
			canDragLinks &&
			(activeDrag === null ||
				(activeDrag.type === "link" && activeDrag.folderId === folderId));
		// Cards use one fixed height (min == max) so every folder card lines up on
		// the grid regardless of how many links it holds; the modal grows instead.
		const heightClass = expanded ? "max-h-[60vh]" : "h-48 md:h-64";

		if (links.length === 0) {
			return (
				<div
					className={`flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500 ${
						expanded ? "" : heightClass
					}`}
				>
					No links yet
				</div>
			);
		}

		const renderRow = (link: ProjectResourceLink, handle: ReactNode) => (
			<div className="group/link rounded-lg border border-slate-200 bg-white px-2.5 py-2 transition hover:border-slate-300 hover:shadow-sm">
				<div className="flex items-start gap-2">
					{canDragLinks ? <div className="mt-1">{handle}</div> : null}
					<LinkFavicon url={link.url} />
					<div className="min-w-0 flex-1">
						<p className="truncate text-xs font-semibold text-slate-900">
							{link.title}
						</p>
						<p className="truncate text-[11px] text-slate-500" title={link.url}>
							{link.url}
						</p>
					</div>
					<div className="flex items-center gap-0.5">
						<button
							type="button"
							title="Copy link"
							onClick={() => void copyLinkUrl(link.url)}
							className="rounded p-1 text-slate-500 opacity-0 transition group-hover/link:opacity-100 focus-visible:opacity-100 hover:bg-slate-100"
						>
							<Copy className="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							title="Edit link"
							onClick={() =>
								setLinkForm({
									id: link.id,
									title: link.title,
									url: link.url,
									description: link.description || "",
									folder_id: folderId ?? "",
								})
							}
							className="rounded p-1 text-slate-500 opacity-0 transition group-hover/link:opacity-100 focus-visible:opacity-100 hover:bg-slate-100"
						>
							<Pencil className="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							title="Delete link"
							onClick={() => void onDeleteLink(link)}
							className="rounded p-1 text-red-500 opacity-0 transition group-hover/link:opacity-100 focus-visible:opacity-100 hover:bg-red-50"
						>
							<Trash2 className="h-3.5 w-3.5" />
						</button>
						<a
							href={link.url}
							target="_blank"
							rel="noopener noreferrer"
							title="Open link"
							className="rounded p-1 text-slate-800 hover:bg-slate-50 hover:text-slate-700"
						>
							<ExternalLink className="h-3.5 w-3.5" />
						</a>
					</div>
				</div>
			</div>
		);

		return (
			<div
				className={`thin-scrollbar space-y-1.5 overflow-y-auto pr-1 md:space-y-2 ${heightClass}`}
			>
				<SortableContext
					items={links.map((link) => link.id)}
					strategy={verticalListSortingStrategy}
					disabled={!linksDraggableHere}
				>
					{links.map((link) => (
						<SortableShell
							key={link.id}
							id={link.id}
							data={{ type: "link", folderId }}
						>
							{(handle) => renderRow(link, handle)}
						</SortableShell>
					))}
				</SortableContext>
			</div>
		);
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
			onDragCancel={() => setActiveDrag(null)}
		>
			<div
				className={`app-shell-bg flex h-full w-full flex-col ${
					activeDrag ? "select-none" : ""
				}`}
			>
				{/* Page identity bar — same shell as the roadmap/timeline/board top bars. */}
				<div className="z-10 flex w-full shrink-0 items-center justify-between overflow-hidden border-b border-gray-200 bg-gray-100">
					<div className="flex min-w-0 shrink-0 items-center gap-2.5 px-4 py-2.5">
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white">
							<BookOpen className="h-4 w-4 text-gray-900" />
						</div>
						<div className="min-w-0 leading-tight">
							<h1 className="text-sm font-semibold text-gray-900">Resources</h1>
							<p className="hidden truncate text-[11px] text-gray-500 md:block">
								Links, docs, and references for this project
							</p>
						</div>
					</div>

					<div className="relative z-20 flex shrink-0 items-center gap-2 border-l border-gray-200 bg-gray-100 px-3 py-2 shadow-sm md:px-6">
						<span className="hidden items-center gap-3 pr-1 text-xs text-gray-500 lg:flex">
							<span>
								<span className="font-semibold text-gray-800">
									{totalFolders}
								</span>{" "}
								folders
							</span>
							<span className="h-3 w-px bg-gray-300" />
							<span>
								<span className="font-semibold text-gray-800">
									{totalLinks}
								</span>{" "}
								links
							</span>
						</span>
						<button
							type="button"
							onClick={() =>
								setFolderForm({
									name: "",
									icon: DEFAULT_FOLDER_ICON,
									color: DEFAULT_FOLDER_COLOR,
								})
							}
							className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
							title="New folder"
						>
							<Folder className="h-4 w-4" />
							New folder
						</button>
						<button
							type="button"
							onClick={() =>
								setLinkForm({
									title: "",
									url: "",
									description: "",
									folder_id: "",
								})
							}
							className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
							title="Add link"
						>
							<Plus className="h-4 w-4" />
							Add link
						</button>
					</div>
				</div>

				<div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
					<div className="w-full px-3 py-4 md:px-8 md:py-8">
						{resourcesQuery.isPending ? (
							<ResourcesSkeleton />
						) : (
							<div className="space-y-4 md:space-y-6">
								<section className="space-y-4">
									<div className="flex flex-col gap-2 app-surface-card p-3 md:flex-row md:items-center md:justify-between md:gap-3 md:p-4">
										<h2 className="text-xs font-semibold uppercase tracking-wide text-slate-700 md:text-sm">
											Folders
										</h2>
										<div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
											<div className="relative w-full sm:w-72">
												<Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
												<input
													type="text"
													value={searchQuery}
													onChange={(e) => setSearchQuery(e.target.value)}
													placeholder="Search folders and links"
													className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
												/>
											</div>
											<div className="relative">
												<SlidersHorizontal className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
												<select
													value={folderFilter}
													onChange={(e) =>
														setFolderFilter(e.target.value as FolderFilter)
													}
													className="h-9 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-8 pr-8 text-sm text-slate-700 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/30 sm:w-44"
												>
													<option value="all">All folders</option>
													<option value="with_links">With links</option>
													<option value="empty">Empty only</option>
												</select>
											</div>
										</div>
									</div>

									{folderCards.length === 0 && !showUncategorizedCard ? (
										<div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center md:p-10">
											<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700">
												<Folder className="h-6 w-6" />
											</div>
											<p className="text-sm font-semibold text-slate-900">
												No matching folders
											</p>
											<p className="mt-1 text-sm text-slate-500">
												Try a different search or filter.
											</p>
										</div>
									) : (
										<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
											{showUncategorizedCard ? (
												<div
													className="group/folder app-surface-card p-3 transition hover:border-slate-300 hover:shadow-md md:p-4"
													style={{
														borderTopWidth: 4,
														borderTopColor: "var(--color-slate-300)",
													}}
												>
													<div className="mb-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
														<div className="flex items-start justify-between gap-3">
															<div className="min-w-0">
																<button
																	type="button"
																	onClick={() => openFolder(UNCATEGORIZED_ID)}
																	className="flex w-full items-center gap-2 text-left"
																>
																	<div className="rounded-md bg-slate-100 p-1.5 text-slate-600">
																		<FolderOpen className="h-3.5 w-3.5" />
																	</div>
																	<h3 className="truncate text-sm font-semibold text-slate-900 hover:underline">
																		Uncategorized
																	</h3>
																</button>
																<p className="mt-1 text-[11px] text-slate-500">
																	{uncategorizedDisplayedLinks.length} link
																	{uncategorizedDisplayedLinks.length === 1
																		? ""
																		: "s"}
																</p>
															</div>
															<div className="flex items-center gap-1">
																<button
																	type="button"
																	title="Copy folder link"
																	onClick={() =>
																		void copyFolderLink(UNCATEGORIZED_ID)
																	}
																	className="rounded-md p-1.5 text-slate-500 opacity-0 transition group-hover/folder:opacity-100 focus-visible:opacity-100 hover:bg-slate-100"
																>
																	<Copy className="h-4 w-4" />
																</button>
																<button
																	type="button"
																	onClick={() =>
																		setLinkForm({
																			title: "",
																			url: "",
																			description: "",
																			folder_id: "",
																		})
																	}
																	className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
																>
																	<Plus className="h-3.5 w-3.5" />
																	Link
																</button>
																<button
																	type="button"
																	title="Expand folder"
																	onClick={() => openFolder(UNCATEGORIZED_ID)}
																	className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
																>
																	<Maximize2 className="h-4 w-4" />
																</button>
															</div>
														</div>
													</div>
													{renderFolderCardLinks(
														uncategorizedDisplayedLinks,
														null,
													)}
												</div>
											) : null}
											<SortableContext
												items={folderCards.map((entry) => entry.folder.id)}
												strategy={rectSortingStrategy}
												disabled={!canDragFolders}
											>
												{folderCards.map(({ folder, displayedLinks }) => {
													const accent = folderColorOf(folder.color);
													const FolderIcon = folderIconOf(folder.icon);
													return (
														<SortableShell
															key={folder.id}
															id={folder.id}
															data={{ type: "folder" }}
															className="group/folder app-surface-card p-3 transition hover:border-slate-300 hover:shadow-md md:p-4"
															style={{
																borderTopWidth: 4,
																borderTopColor: accent.accent,
															}}
														>
															{(handle) => (
																<>
																	<div className="mb-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
																		<div className="flex items-start justify-between gap-3">
																			<div className="min-w-0">
																				<div className="flex items-center gap-1">
																					{canDragFolders ? handle : null}
																					<button
																						type="button"
																						onClick={() =>
																							openFolder(folder.id)
																						}
																						className="flex min-w-0 flex-1 items-center gap-2 text-left"
																					>
																						<div className="rounded-md bg-slate-100 p-1.5 text-slate-600">
																							<FolderIcon className="h-3.5 w-3.5" />
																						</div>
																						<h3 className="truncate text-sm font-semibold text-slate-900 hover:underline">
																							{folder.name}
																						</h3>
																					</button>
																				</div>
																				<p className="mt-1 text-[11px] text-slate-500">
																					{displayedLinks.length} link
																					{displayedLinks.length === 1
																						? ""
																						: "s"}
																				</p>
																			</div>

																			<div className="flex items-center gap-1">
																				<button
																					type="button"
																					title="Copy folder link"
																					onClick={() =>
																						void copyFolderLink(folder.id)
																					}
																					className="rounded-md p-1.5 text-slate-500 opacity-0 transition group-hover/folder:opacity-100 focus-visible:opacity-100 hover:bg-slate-100"
																				>
																					<Copy className="h-4 w-4" />
																				</button>
																				<button
																					type="button"
																					title="Edit folder"
																					onClick={() =>
																						setFolderForm({
																							id: folder.id,
																							name: folder.name,
																							icon:
																								folder.icon ??
																								DEFAULT_FOLDER_ICON,
																							color:
																								folder.color ??
																								DEFAULT_FOLDER_COLOR,
																						})
																					}
																					className="rounded-md p-1.5 text-slate-500 opacity-0 transition group-hover/folder:opacity-100 focus-visible:opacity-100 hover:bg-slate-100"
																				>
																					<Pencil className="h-4 w-4" />
																				</button>
																				<button
																					type="button"
																					title="Delete folder"
																					onClick={() =>
																						void onDeleteFolder(folder)
																					}
																					className="rounded-md p-1.5 text-red-500 opacity-0 transition group-hover/folder:opacity-100 focus-visible:opacity-100 hover:bg-red-50"
																				>
																					<Trash2 className="h-4 w-4" />
																				</button>
																				<button
																					type="button"
																					onClick={() =>
																						setLinkForm({
																							title: "",
																							url: "",
																							description: "",
																							folder_id: folder.id,
																						})
																					}
																					className="ml-1 inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
																				>
																					<Plus className="h-3.5 w-3.5" />
																					Link
																				</button>
																				<button
																					type="button"
																					title="Expand folder"
																					onClick={() => openFolder(folder.id)}
																					className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
																				>
																					<Maximize2 className="h-4 w-4" />
																				</button>
																			</div>
																		</div>
																	</div>

																	{renderFolderCardLinks(
																		displayedLinks,
																		folder.id,
																	)}
																</>
															)}
														</SortableShell>
													);
												})}
											</SortableContext>
										</div>
									)}
								</section>
							</div>
						)}
					</div>
				</div>

				{openedFolder && (
					<ResourceModal
						title={openedFolder.name}
						maxWidthClass="max-w-2xl"
						onClose={closeFolder}
						headerExtra={
							<button
								type="button"
								onClick={() =>
									void copyFolderLink(openedFolder.id ?? UNCATEGORIZED_ID)
								}
								className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
							>
								<Copy className="h-3.5 w-3.5" />
								Copy link
							</button>
						}
					>
						<div className="space-y-3">
							<div className="flex items-center justify-between gap-2">
								<p className="text-xs text-slate-500">
									{openedFolder.links.length} link
									{openedFolder.links.length === 1 ? "" : "s"}
								</p>
								<button
									type="button"
									onClick={() =>
										setLinkForm({
											title: "",
											url: "",
											description: "",
											folder_id: openedFolder.id ?? "",
										})
									}
									className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
								>
									<Plus className="h-3.5 w-3.5" />
									Add link
								</button>
							</div>
							{renderFolderCardLinks(openedFolder.links, openedFolder.id, true)}
						</div>
					</ResourceModal>
				)}

				{folderForm &&
					(() => {
						const preview = folderColorOf(folderForm.color);
						const PreviewIcon = folderIconOf(folderForm.icon);
						const previewLinkCount = folderForm.id
							? ((resources.folders ?? []).find((f) => f.id === folderForm.id)
									?.links?.length ?? 0)
							: 0;

						return (
							<ResourceModal
								title={folderForm.id ? "Edit Folder" : "Create Folder"}
								maxWidthClass="max-w-3xl"
								onClose={() => setFolderForm(null)}
							>
								<div className="space-y-4">
									<div className="grid gap-5 md:grid-cols-2">
										{/* Left: the controls. */}
										<div className="space-y-4">
											<div>
												<label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
													Folder name
												</label>
												<input
													type="text"
													value={folderForm.name}
													onChange={(e) =>
														setFolderForm((prev) =>
															prev ? { ...prev, name: e.target.value } : prev,
														)
													}
													placeholder="Design references"
													className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
												/>
											</div>

											<div>
												<label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
													Color
												</label>
												<div className="flex flex-wrap gap-2">
													{RESOURCE_FOLDER_COLORS.map((entry) => (
														<button
															key={entry.token}
															type="button"
															title={entry.label}
															aria-label={entry.label}
															aria-pressed={folderForm.color === entry.token}
															onClick={() =>
																setFolderForm((prev) =>
																	prev ? { ...prev, color: entry.token } : prev,
																)
															}
															className={`h-7 w-7 rounded-md ${entry.swatch} ${
																folderForm.color === entry.token
																	? "ring-2 ring-slate-900 ring-offset-2"
																	: "hover:opacity-80"
															}`}
														/>
													))}
												</div>
											</div>

											<div>
												<label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
													Icon
												</label>
												<div className="grid grid-cols-8 gap-1.5">
													{RESOURCE_FOLDER_ICONS.map(({ token, Icon }) => (
														<button
															key={token}
															type="button"
															title={token}
															aria-label={token}
															aria-pressed={folderForm.icon === token}
															onClick={() =>
																setFolderForm((prev) =>
																	prev ? { ...prev, icon: token } : prev,
																)
															}
															className={`flex h-8 items-center justify-center rounded-md border transition ${
																folderForm.icon === token
																	? "border-slate-900 bg-slate-900 text-white"
																	: "border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900"
															}`}
														>
															<Icon className="h-4 w-4" />
														</button>
													))}
												</div>
											</div>
										</div>

										{/* Right: the folder card as the grid will render it. */}
										<div className="min-w-0">
											<p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
												Preview
											</p>
											<div
												className="app-surface-card p-3 md:p-4"
												style={{
													borderTopWidth: 4,
													borderTopColor: preview.accent,
												}}
											>
												<div className="mb-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
													<div className="flex items-start justify-between gap-3">
														<div className="min-w-0">
															<div className="flex items-center gap-1">
																<div className="inline-flex h-6 w-5 shrink-0 items-center justify-center rounded text-slate-400">
																	<GripVertical className="h-3.5 w-3.5" />
																</div>
																<div className="flex min-w-0 flex-1 items-center gap-2">
																	<div className="rounded-md bg-slate-100 p-1.5 text-slate-600">
																		<PreviewIcon className="h-3.5 w-3.5" />
																	</div>
																	<h3 className="truncate text-sm font-semibold text-slate-900">
																		{folderForm.name.trim() || "Folder name"}
																	</h3>
																</div>
															</div>
															<p className="mt-1 text-[11px] text-slate-500">
																{previewLinkCount} link
																{previewLinkCount === 1 ? "" : "s"}
															</p>
														</div>
														<div className="flex items-center gap-1 text-slate-400">
															<Pencil className="h-4 w-4" />
															<Trash2 className="h-4 w-4 text-red-400" />
															<span className="ml-1 inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500">
																<Plus className="h-3.5 w-3.5" />
																Link
															</span>
															<Maximize2 className="h-4 w-4" />
														</div>
													</div>
												</div>
												<div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center text-xs text-slate-500">
													{previewLinkCount > 0
														? `${previewLinkCount} link${previewLinkCount === 1 ? "" : "s"} live here`
														: "No links yet"}
												</div>
											</div>
										</div>
									</div>

									<div className="flex items-center justify-end gap-2">
										<button
											type="button"
											onClick={() => setFolderForm(null)}
											className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
										>
											Cancel
										</button>
										<button
											type="button"
											onClick={() => void onSaveFolder()}
											disabled={isBusy}
											className="inline-flex items-center gap-1 rounded-md app-cta px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
										>
											{isBusy ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : null}
											Save
										</button>
									</div>
								</div>
							</ResourceModal>
						);
					})()}

				{linkForm && (
					<ResourceModal
						title={linkForm.id ? "Edit Link" : "Add Link"}
						onClose={() => setLinkForm(null)}
					>
						<div className="space-y-3">
							<div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
								<div className="rounded-lg bg-slate-100 p-1.5 text-slate-800">
									<Link2 className="h-4 w-4" />
								</div>
								<p className="text-xs text-slate-700">
									Add a quick project reference and organize it in a folder.
								</p>
							</div>

							<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
								<div>
									<label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
										Title
									</label>
									<input
										type="text"
										value={linkForm.title}
										onChange={(e) =>
											setLinkForm((prev) =>
												prev ? { ...prev, title: e.target.value } : prev,
											)
										}
										placeholder="API Docs"
										className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
									/>
								</div>

								<div>
									<label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
										Folder
									</label>
									<select
										value={linkForm.folder_id}
										onChange={(e) =>
											setLinkForm((prev) =>
												prev ? { ...prev, folder_id: e.target.value } : prev,
											)
										}
										className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
									>
										<option value="">Uncategorized</option>
										{folderOptions.map((folder) => (
											<option key={folder.id} value={folder.id}>
												{folder.name}
											</option>
										))}
									</select>
								</div>
							</div>

							<div>
								<label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
									URL
								</label>
								{/* Chrome omnibox styling: favicon pill, muted until focused. */}
								<div className="group flex h-9 w-full items-center gap-2 rounded-full border border-slate-300 bg-slate-100 pl-2 pr-2 transition focus-within:border-slate-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-slate-400/30 hover:bg-slate-50">
									<LinkFavicon
										url={linkForm.url}
										className="h-4 w-4"
										wrapperClassName="flex h-5 w-5 shrink-0 items-center justify-center text-slate-500"
									/>
									<input
										type="url"
										value={linkForm.url}
										onChange={(e) =>
											setLinkForm((prev) =>
												prev ? { ...prev, url: e.target.value } : prev,
											)
										}
										placeholder="Search or type a URL"
										spellCheck={false}
										autoComplete="off"
										className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-0"
									/>
									{linkForm.url.trim() ? (
										<a
											href={linkForm.url}
											target="_blank"
											rel="noopener noreferrer"
											title="Open link"
											className="rounded-full p-1 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
										>
											<ExternalLink className="h-3.5 w-3.5" />
										</a>
									) : null}
								</div>
							</div>

							<div>
								<label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
									Description (optional)
								</label>
								<textarea
									rows={2}
									value={linkForm.description}
									onChange={(e) =>
										setLinkForm((prev) =>
											prev ? { ...prev, description: e.target.value } : prev,
										)
									}
									placeholder="What this resource is for"
									className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
								/>
							</div>

							<div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2">
								<button
									type="button"
									onClick={() => setLinkForm(null)}
									className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={() => void onSaveLink()}
									disabled={isBusy}
									className="inline-flex items-center gap-1 rounded-md app-cta px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
								>
									{isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
									Save
								</button>
							</div>
						</div>
					</ResourceModal>
				)}
			</div>

			<DragOverlay dropAnimation={{ duration: 200 }}>
				{activeFolder ? (
					<div className="w-72 cursor-grabbing rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-lg">
						<div className="flex items-center gap-2">
							<div className="rounded-md bg-slate-100 p-1.5 text-slate-600">
								<Folder className="h-3.5 w-3.5" />
							</div>
							<h3 className="truncate text-sm font-semibold text-slate-900">
								{activeFolder.name}
							</h3>
						</div>
						<p className="mt-1 text-[11px] text-slate-500">
							{activeFolder.links?.length ?? 0} link
							{(activeFolder.links?.length ?? 0) === 1 ? "" : "s"}
						</p>
					</div>
				) : activeLink ? (
					<div className="w-64 cursor-grabbing rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-lg">
						<div className="flex items-start gap-2">
							<LinkFavicon url={activeLink.url} />
							<div className="min-w-0 flex-1">
								<p className="truncate text-xs font-semibold text-slate-900">
									{activeLink.title}
								</p>
								<p className="truncate text-[11px] text-slate-500">
									{activeLink.url}
								</p>
							</div>
						</div>
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
