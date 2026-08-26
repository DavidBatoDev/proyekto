import type { LucideIcon } from "lucide-react";
import { HEADER_NAV_ITEMS } from "@/components/layout/headerNavigation";
import { EXECUTION_PRIMARY_NAV_ITEMS } from "@/components/layout/sidebar/executionNavigation";
import { FINANCE_NAV_ITEMS } from "@/components/layout/sidebar/financeNavigation";
import { MARKETPLACE_NAV_ITEMS } from "@/components/layout/sidebar/marketplaceNavigation";
import type { Project } from "@/services/project.service";
import type { FullRoadmapWithProject } from "@/services/roadmap.service";

/**
 * The global header search's candidate model. One flat array in a fixed group
 * order (pages, then projects, then work items) is the single source of truth
 * for both the rendered rows and the keyboard's activeIndex, so the highlighted
 * row and the row Enter commits can never disagree (the mentionCandidates
 * lesson).
 */
export type GlobalSearchCandidate =
	| { kind: "page"; key: string; label: string; to: string; icon?: LucideIcon }
	| { kind: "project"; id: string; title: string }
	| {
			kind: "workItem";
			type: "epic" | "feature" | "task";
			id: string;
			title: string;
			roadmapId: string;
			projectId: string | null;
			epicTitle?: string;
			featureTitle?: string;
			projectTitle?: string;
	  };

export interface SearchablePage {
	key: string;
	label: string;
	to: string;
	icon?: LucideIcon;
}

const PROJECT_RESULT_CAP = 5;
const WORK_ITEM_RESULT_CAP = 8;

/**
 * Every destination the search can offer, resolved for one user. Merges the
 * header nav with both sidebars' nav (marketplace children included, labeled
 * "Finance · Invoices" style) and dedupes by path — `/engagements` and
 * `/dashboard` each appear in two sources. The sidebar entries win the dedupe
 * because they carry icons.
 *
 * `consultant` is the caller's `isActiveConsultant(profile)` — gated entries
 * must not surface to users who cannot open them.
 */
export function buildSearchablePages(consultant: boolean): SearchablePage[] {
	const byPath = new Map<string, SearchablePage>();

	const add = (page: SearchablePage) => {
		const existing = byPath.get(page.to);
		if (!existing || (!existing.icon && page.icon)) {
			byPath.set(page.to, page);
		}
	};

	for (const item of EXECUTION_PRIMARY_NAV_ITEMS) {
		add({ key: item.key, label: item.label, to: item.to, icon: item.icon });
	}

	for (const item of MARKETPLACE_NAV_ITEMS) {
		if (item.requires === "consultant" && !consultant) continue;
		add({ key: item.key, label: item.label, to: item.to, icon: item.icon });
		for (const child of item.children ?? []) {
			add({
				key: child.key,
				label: `${item.label} · ${child.label}`,
				to: child.to,
				icon: child.icon,
			});
		}
	}

	// The finance shell's nav ("Finance · Invoices" style), since finance left
	// the marketplace sidebar. Its own "engagements" back-link dedupes against
	// the entries above.
	for (const item of FINANCE_NAV_ITEMS) {
		if (item.requires === "consultant" && !consultant) continue;
		add({
			key: item.key,
			label:
				item.key === "engagements" ? item.label : `Finance · ${item.label}`,
			to: item.to,
			icon: item.icon,
		});
	}

	for (const item of HEADER_NAV_ITEMS) {
		add({ key: `header-${item.to}`, label: item.label, to: item.to });
	}

	return [...byPath.values()];
}

export interface GlobalSearchInput {
	query: string;
	pages: SearchablePage[];
	projects: Project[];
	roadmaps: FullRoadmapWithProject[];
}

/**
 * Case-insensitive substring matching — the app-wide convention (see
 * buildExplorerSearchResults, buildMentionCandidates); no fuzzy library exists
 * and none should be introduced here.
 */
export function buildGlobalSearchCandidates({
	query,
	pages,
	projects,
	roadmaps,
}: GlobalSearchInput): GlobalSearchCandidate[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return [];

	const matches = (text: string | null | undefined) =>
		Boolean(text?.toLowerCase().includes(normalized));

	const results: GlobalSearchCandidate[] = [];

	for (const page of pages) {
		if (matches(page.label)) {
			results.push({ kind: "page", ...page });
		}
	}

	let projectCount = 0;
	for (const project of projects) {
		if (projectCount >= PROJECT_RESULT_CAP) break;
		if (matches(project.title)) {
			results.push({ kind: "project", id: project.id, title: project.title });
			projectCount += 1;
		}
	}

	let workItemCount = 0;
	const pushWorkItem = (candidate: GlobalSearchCandidate) => {
		if (workItemCount >= WORK_ITEM_RESULT_CAP) return;
		results.push(candidate);
		workItemCount += 1;
	};

	for (const roadmap of roadmaps) {
		if (workItemCount >= WORK_ITEM_RESULT_CAP) break;
		const base = {
			roadmapId: roadmap.id,
			projectId: roadmap.project?.id ?? null,
			projectTitle: roadmap.project?.title,
		};
		const epics = [...(roadmap.epics ?? [])].sort(
			(a, b) => (a.position ?? 0) - (b.position ?? 0),
		);
		for (const epic of epics) {
			if (matches(epic.title)) {
				pushWorkItem({
					kind: "workItem",
					type: "epic",
					id: epic.id,
					title: epic.title,
					...base,
				});
			}
			for (const feature of epic.features ?? []) {
				if (matches(feature.title)) {
					pushWorkItem({
						kind: "workItem",
						type: "feature",
						id: feature.id,
						title: feature.title,
						epicTitle: epic.title,
						...base,
					});
				}
				for (const task of feature.tasks ?? []) {
					if (matches(task.title)) {
						pushWorkItem({
							kind: "workItem",
							type: "task",
							id: task.id,
							title: task.title,
							epicTitle: epic.title,
							featureTitle: feature.title,
							...base,
						});
					}
				}
			}
		}
	}

	return results;
}

export interface CandidateDestination {
	to: string;
	params?: Record<string, string>;
	// nodeId is the raw entity uuid; the roadmap route's deep-link resolver
	// pans to it and opens its panel.
	search?: { nodeId: string };
}

export function resolveCandidateDestination(
	candidate: GlobalSearchCandidate,
): CandidateDestination {
	switch (candidate.kind) {
		case "page":
			return { to: candidate.to };
		case "project":
			return {
				to: "/project/$projectId/roadmap",
				params: { projectId: candidate.id },
			};
		case "workItem":
			return {
				to: "/project/$projectId/roadmap/$roadmapId",
				params: {
					// Standalone roadmaps (no project) route through the "n"
					// sentinel, same as HeroChatInput.
					projectId: candidate.projectId ?? "n",
					roadmapId: candidate.roadmapId,
				},
				search: { nodeId: candidate.id },
			};
	}
}

export type GlobalSearchGroup = "page" | "project" | "workItem";

export const GROUP_LABELS: Record<GlobalSearchGroup, string> = {
	page: "Pages",
	project: "Projects",
	workItem: "Work items",
};
