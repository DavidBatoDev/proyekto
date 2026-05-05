import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Folder,
  FolderOpen,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  projectService,
  type ProjectResourceFolder,
  type ProjectResourceLink,
  type ProjectResourcesPayload,
} from "@/services/project.service";
import { useToast } from "@/hooks/useToast";
import {
  useInvalidateProjectQueries,
  useProjectResourcesQuery,
} from "@/hooks/useProjectQueries";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";

export const Route = createFileRoute("/project/$projectId/resources")({
  component: ResourcesRoute,
});

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
};

type FolderFilter = "all" | "with_links" | "empty";

const initialPayload: ProjectResourcesPayload = {
  folders: [],
  uncategorized_links: [],
};

function getHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "resource";
  }
}

function moveIndex<T>(items: T[], from: number, to: number): T[] {
  const cloned = [...items];
  const [item] = cloned.splice(from, 1);
  cloned.splice(to, 0, item);
  return cloned;
}

function ResourceModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/35 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_48px_rgba(15,23,42,0.2)]">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
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
  );
}

function ResourcesSkeleton() {
  return (
    <div className="mt-8 space-y-6 animate-pulse">
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
          <div key={`resources-skeleton-${index}`} className="min-h-[320px] app-surface-card p-4">
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
  const toast = useToast();
  const resourcesQuery = useProjectResourcesQuery(projectId);
  const { invalidateResources } = useInvalidateProjectQueries(projectId);

  const [resources, setResources] = useState<ProjectResourcesPayload>(initialPayload);
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
    () => (resources.folders ?? []).map((folder) => ({ id: folder.id, name: folder.name })),
    [resources.folders],
  );

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const linkMatchesSearch = (link: ProjectResourceLink) => {
    if (!normalizedSearch) return true;
    const haystack = `${link.title} ${link.url} ${link.description ?? ""}`.toLowerCase();
    return haystack.includes(normalizedSearch);
  };

  const folderCards = (resources.folders ?? [])
    .map((folder) => {
      const allLinks = folder.links ?? [];
      const folderNameMatch = folder.name.toLowerCase().includes(normalizedSearch);
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

  const uncategorizedDisplayedLinks = (resources.uncategorized_links ?? []).filter(linkMatchesSearch);
  const showUncategorizedCard = uncategorizedDisplayedLinks.length > 0;

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
        if (folderForm.id) {
          await projectService.updateResourceFolder(projectId, folderForm.id, { name });
          toast.success("Folder updated");
        } else {
          await projectService.createResourceFolder(projectId, { name });
          toast.success("Folder created");
        }
        setFolderForm(null);
        await invalidateResources();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to save folder");
      }
    });
  };

  const onDeleteFolder = async (folder: ProjectResourceFolder) => {
    if (!confirm(`Delete folder \"${folder.name}\"? Links will move to uncategorized.`)) {
      return;
    }

    await runWithBusy(async () => {
      try {
        await projectService.deleteResourceFolder(projectId, folder.id);
        toast.success("Folder deleted");
        await invalidateResources();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to delete folder");
      }
    });
  };

  const reorderFolders = async (next: ProjectResourceFolder[]) => {
    await runWithBusy(async () => {
      try {
        setResources((prev) => ({ ...prev, folders: next }));
        await projectService.reorderResourceFolders(
          projectId,
          next.map((folder, index) => ({ id: folder.id, position: index })),
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to reorder folders");
        await invalidateResources();
      }
    });
  };

  const reorderLinks = async (folderId: string | null, next: ProjectResourceLink[]) => {
    await runWithBusy(async () => {
      try {
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

        await projectService.reorderResourceLinks(projectId, {
          folder_id: folderId,
          items: next.map((link, index) => ({ id: link.id, position: index })),
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to reorder links");
        await invalidateResources();
      }
    });
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
      toast.error("Invalid link payload received. Please refresh and try again.");
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
          const updatedLink = await projectService.updateResourceLink(projectId, linkForm.id, {
            title,
            url,
            description: description || undefined,
            folder_id,
          });
          if (mergeLinkIntoState(updatedLink)) {
            toast.success("Link updated");
          }
        } else {
          const createdLink = await projectService.createResourceLink(projectId, {
            title,
            url,
            description: description || undefined,
            folder_id,
          });
          if (mergeLinkIntoState(createdLink)) {
            toast.success("Link created");
          }
        }

        setLinkForm(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to save link");
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
        toast.error(error instanceof Error ? error.message : "Failed to delete link");
      }
    });
  };

  const renderFolderCardLinks = (links: ProjectResourceLink[], folderId: string | null) => {
    if (links.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
          No links yet
        </div>
      );
    }

    return (
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {links.map((link, index) => {
          const canMoveUp = index > 0;
          const canMoveDown = index < links.length - 1;

          return (
            <div
              key={link.id}
              className="group/link rounded-lg border border-slate-200 bg-white px-2.5 py-2 transition hover:border-slate-300 hover:shadow-sm"
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 rounded-md bg-slate-100 p-1.5 text-slate-700">
                  <Link2 className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-900">{link.title}</p>
                  <p className="truncate text-[11px] text-slate-500">{getHostname(link.url)}</p>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    title="Move up"
                    onClick={() => {
                      if (!canMoveUp) return;
                      const next = moveIndex(links, index, index - 1);
                      void reorderLinks(folderId, next);
                    }}
                    disabled={!canMoveUp || isBusy}
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-35"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    onClick={() => {
                      if (!canMoveDown) return;
                      const next = moveIndex(links, index, index + 1);
                      void reorderLinks(folderId, next);
                    }}
                    disabled={!canMoveDown || isBusy}
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-35"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
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
        })}
      </div>
    );
  };

  return (
    <div className="app-shell-bg h-full w-full overflow-y-auto">
      <div className="w-full px-4 py-6 md:px-8 md:py-8">
        <div className="app-surface-card-strong p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-slate-700" />
                <h1 className="text-2xl font-bold text-slate-900">Resources</h1>
              </div>
              <p className="text-sm text-slate-600">
                Organize project links, docs, and references in a clean workspace.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 md:w-[300px]">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-lg font-bold text-slate-800">{totalFolders}</p>
                <p className="text-xs text-slate-500">Folders</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-lg font-bold text-slate-800">{totalLinks}</p>
                <p className="text-xs text-slate-500">Hyperlinks</p>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFolderForm({ name: "" })}
              className="app-cta inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white"
            >
              <Folder className="h-4 w-4" />
              New folder
            </button>
            <button
              type="button"
              onClick={() =>
                setLinkForm({ title: "", url: "", description: "", folder_id: "" })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" />
              Add link
            </button>
          </div>
        </div>

        {resourcesQuery.isPending ? (
          <ResourcesSkeleton />
        ) : (
          <div className="mt-8 space-y-6">
            <section className="space-y-4">
              <div className="flex flex-col gap-3 app-surface-card p-4 md:flex-row md:items-center md:justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
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
                      onChange={(e) => setFolderFilter(e.target.value as FolderFilter)}
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
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                    <Folder className="h-6 w-6" />
                  </div>
                  <p className="text-sm font-semibold text-slate-900">No matching folders</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Try a different search or filter.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {showUncategorizedCard ? (
                    <div className="group/folder min-h-[320px] app-surface-card p-4 transition hover:border-slate-300 hover:shadow-md">
                      <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="rounded-md bg-slate-100 p-1.5 text-slate-600">
                              <FolderOpen className="h-3.5 w-3.5" />
                            </div>
                            <h3 className="truncate text-sm font-semibold text-slate-900">
                              Uncategorized
                            </h3>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {uncategorizedDisplayedLinks.length} link
                            {uncategorizedDisplayedLinks.length === 1 ? "" : "s"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setLinkForm({ title: "", url: "", description: "", folder_id: "" })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Link
                        </button>
                        </div>
                      </div>
                      {renderFolderCardLinks(uncategorizedDisplayedLinks, null)}
                    </div>
                  ) : null}
                  {folderCards.map(({ folder, displayedLinks }) => {
                  const originalIndex = (resources.folders ?? []).findIndex((f) => f.id === folder.id);
                  const canMoveUp = originalIndex > 0;
                  const canMoveDown = originalIndex < (resources.folders?.length ?? 0) - 1;
                  return (
                    <div
                      key={folder.id}
                      className="group/folder min-h-[320px] app-surface-card p-4 transition hover:border-slate-300 hover:shadow-md"
                    >
                      <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="rounded-md bg-slate-100 p-1.5 text-slate-600">
                              <Folder className="h-3.5 w-3.5" />
                            </div>
                            <h3 className="truncate text-sm font-semibold text-slate-900">
                              {folder.name}
                            </h3>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {displayedLinks.length} link
                            {displayedLinks.length === 1 ? "" : "s"}
                          </p>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            title="Move folder up"
                            onClick={() => {
                              if (!canMoveUp) return;
                              const next = moveIndex(resources.folders, originalIndex, originalIndex - 1);
                              void reorderFolders(next);
                            }}
                            disabled={!canMoveUp || isBusy}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="Move folder down"
                            onClick={() => {
                              if (!canMoveDown) return;
                              const next = moveIndex(resources.folders, originalIndex, originalIndex + 1);
                              void reorderFolders(next);
                            }}
                            disabled={!canMoveDown || isBusy}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="Edit folder"
                            onClick={() =>
                              setFolderForm({
                                id: folder.id,
                                name: folder.name,
                              })
                            }
                            className="rounded-md p-1.5 text-slate-500 opacity-0 transition group-hover/folder:opacity-100 focus-visible:opacity-100 hover:bg-slate-100"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="Delete folder"
                            onClick={() => void onDeleteFolder(folder)}
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
                        </div>
                        </div>
                      </div>

                      {renderFolderCardLinks(displayedLinks, folder.id)}
                    </div>
                  );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {folderForm && (
        <ResourceModal
          title={folderForm.id ? "Edit Folder" : "Create Folder"}
          onClose={() => setFolderForm(null)}
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Folder name
              </label>
              <input
                type="text"
                value={folderForm.name}
                onChange={(e) =>
                  setFolderForm((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                }
                placeholder="Design references"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
              />
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
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </button>
            </div>
          </div>
        </ResourceModal>
      )}

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
                    setLinkForm((prev) => (prev ? { ...prev, title: e.target.value } : prev))
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
                    setLinkForm((prev) => (prev ? { ...prev, folder_id: e.target.value } : prev))
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
              <input
                type="url"
                value={linkForm.url}
                onChange={(e) =>
                  setLinkForm((prev) => (prev ? { ...prev, url: e.target.value } : prev))
                }
                placeholder="https://..."
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
              />
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
  );
}

