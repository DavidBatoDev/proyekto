import { useNavigate } from "@tanstack/react-router";
import { Folder, Search } from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { RoadmapNodeGlyph } from "@/components/common/NodeGlyph";
import { useDashboardProjectsQuery } from "@/hooks/useDashboardProjectsQuery";
import { useAllRoadmapsFullQuery } from "@/hooks/useProjectQueries";
import { isActiveConsultant } from "@/lib/auth-utils";
import type { Project } from "@/services/project.service";
import type { FullRoadmapWithProject } from "@/services/roadmap.service";
import { useProfile, useUser } from "@/stores/authStore";
import {
	buildGlobalSearchCandidates,
	buildSearchablePages,
	type GlobalSearchCandidate,
	GROUP_LABELS,
	resolveCandidateDestination,
} from "./globalSearch";

interface GlobalSearchBarProps {
	/**
	 * Reports focus-driven expansion so the host header can collapse its nav
	 * links while the search is active. Hosts with a fixed-width slot
	 * (ProjectHeader) simply omit it.
	 */
	onExpandedChange?: (expanded: boolean) => void;
	className?: string;
}

/**
 * The one working header search, shared by DashboardHeader and ProjectHeader.
 * Searches pages, the user's projects, and roadmap work items client-side;
 * "/" focuses it from anywhere outside a text field.
 */
export function GlobalSearchBar(props: GlobalSearchBarProps) {
	// ProjectHeader renders for unauthenticated guests (roadmap-only mode);
	// the search has nothing to show them. Gating outside the inner component
	// keeps its hook order stable across auth transitions.
	const user = useUser();
	if (!user) return null;
	return <GlobalSearchBarInner {...props} />;
}

function GlobalSearchBarInner({
	onExpandedChange,
	className = "",
}: GlobalSearchBarProps) {
	const navigate = useNavigate();
	const profile = useProfile();
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listId = useId();

	const pages = useMemo(
		() => buildSearchablePages(isActiveConsultant(profile)),
		[profile],
	);
	const projectsQuery = useDashboardProjectsQuery();
	// Enabled only while the search is open: the all-full payload is every
	// accessible roadmap fully nested, and its refetchOnWindowFocus would
	// otherwise re-pull it on every window focus from every page.
	const roadmapsQuery = useAllRoadmapsFullQuery({ enabled: active });

	const candidates = useMemo(
		() =>
			buildGlobalSearchCandidates({
				query,
				pages,
				projects: (projectsQuery.data as Project[] | undefined) ?? [],
				roadmaps:
					(roadmapsQuery.data as FullRoadmapWithProject[] | undefined) ?? [],
			}),
		[query, pages, projectsQuery.data, roadmapsQuery.data],
	);

	const showDropdown = active && query.trim().length > 0;
	const searchingWorkItems =
		roadmapsQuery.isPending && roadmapsQuery.isFetching;

	const close = useCallback(() => {
		setActive(false);
		setQuery("");
		setActiveIndex(0);
	}, []);

	useEffect(() => {
		onExpandedChange?.(active);
	}, [active, onExpandedChange]);

	// Reset keyboard position whenever the result set changes.
	useEffect(() => {
		setActiveIndex(0);
	}, [query]);

	// Close on any press outside — not onBlur, so clicking an option never
	// races the input's blur (the options live inside containerRef).
	useEffect(() => {
		if (!active) return;
		const onMouseDown = (event: MouseEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) {
				close();
			}
		};
		document.addEventListener("mousedown", onMouseDown);
		return () => document.removeEventListener("mousedown", onMouseDown);
	}, [active, close]);

	// "/" focuses the search from anywhere that isn't already a text field.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey)
				return;
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				target.closest("input, textarea, select, [contenteditable]")
			)
				return;
			if (document.querySelector('[role="dialog"]')) return;
			event.preventDefault();
			inputRef.current?.focus();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const selectCandidate = (candidate: GlobalSearchCandidate) => {
		const destination = resolveCandidateDestination(candidate);
		void navigate({
			to: destination.to,
			params: destination.params,
			search: destination.search,
		});
		close();
		inputRef.current?.blur();
	};

	const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			if (showDropdown) {
				setQuery("");
				setActiveIndex(0);
			} else {
				close();
				inputRef.current?.blur();
			}
			return;
		}
		if (!showDropdown || candidates.length === 0) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			setActiveIndex(
				(index) => (index + step + candidates.length) % candidates.length,
			);
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			const candidate = candidates[activeIndex];
			if (candidate) selectCandidate(candidate);
		}
	};

	return (
		<div ref={containerRef} className={`relative ${className}`}>
			<div className="flex w-full items-stretch overflow-hidden rounded-md border border-border bg-muted/80 transition-all duration-200 hover:bg-muted focus-within:bg-card focus-within:ring-2 focus-within:ring-border">
				<input
					ref={inputRef}
					type="text"
					role="combobox"
					aria-expanded={showDropdown}
					aria-controls={listId}
					aria-autocomplete="list"
					aria-activedescendant={
						showDropdown && candidates.length > 0
							? `${listId}-opt-${activeIndex}`
							: undefined
					}
					aria-label="Search"
					placeholder="Search..."
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onFocus={() => setActive(true)}
					onKeyDown={onInputKeyDown}
					className="min-w-0 flex-1 border-none bg-transparent px-3 py-1.5 text-[0.85rem] text-foreground placeholder:text-muted-foreground focus:outline-none"
				/>
				{!active && (
					<kbd className="mr-2 hidden shrink-0 self-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground lg:inline-block">
						/
					</kbd>
				)}
				<button
					type="button"
					tabIndex={-1}
					aria-hidden="true"
					onClick={() => inputRef.current?.focus()}
					className="flex shrink-0 items-center justify-center bg-primary px-2.5 text-primary-foreground transition-colors hover:bg-primary/90"
				>
					<Search size={16} />
				</button>
			</div>

			{showDropdown && (
				<div
					id={listId}
					role="listbox"
					aria-label="Search results"
					className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-lg"
				>
					{candidates.map((candidate, index) => {
						const previous = candidates[index - 1];
						const showGroupLabel =
							!previous || previous.kind !== candidate.kind;
						return (
							<CandidateRow
								key={candidateKey(candidate)}
								candidate={candidate}
								optionId={`${listId}-opt-${index}`}
								isActive={index === activeIndex}
								showGroupLabel={showGroupLabel}
								onHover={() => setActiveIndex(index)}
								onSelect={() => selectCandidate(candidate)}
							/>
						);
					})}
					{searchingWorkItems && (
						<div className="px-3 py-1.5 text-xs text-muted-foreground">
							Searching work items…
						</div>
					)}
					{candidates.length === 0 && !searchingWorkItems && (
						<div className="px-3 py-2 text-sm text-muted-foreground">
							No results
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function candidateKey(candidate: GlobalSearchCandidate): string {
	switch (candidate.kind) {
		case "page":
			return `page-${candidate.to}`;
		case "project":
			return `project-${candidate.id}`;
		case "workItem":
			return `work-${candidate.type}-${candidate.id}`;
	}
}

function CandidateRow({
	candidate,
	optionId,
	isActive,
	showGroupLabel,
	onHover,
	onSelect,
}: {
	candidate: GlobalSearchCandidate;
	optionId: string;
	isActive: boolean;
	showGroupLabel: boolean;
	onHover: () => void;
	onSelect: () => void;
}) {
	return (
		<>
			{showGroupLabel && (
				<div
					role="presentation"
					className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
				>
					{GROUP_LABELS[candidate.kind]}
				</div>
			)}
			<button
				type="button"
				role="option"
				id={optionId}
				aria-selected={isActive}
				onMouseEnter={onHover}
				onClick={onSelect}
				className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
					isActive ? "bg-muted" : ""
				}`}
			>
				<CandidateIcon candidate={candidate} />
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-medium text-foreground">
						{candidate.kind === "project" || candidate.kind === "workItem"
							? candidate.title
							: candidate.label}
					</div>
					{candidate.kind === "workItem" && (
						<div className="mt-0.5 truncate text-[11px] text-muted-foreground">
							{[
								candidate.projectTitle,
								candidate.epicTitle,
								candidate.featureTitle,
							]
								.filter(Boolean)
								.join(" › ")}
						</div>
					)}
				</div>
			</button>
		</>
	);
}

function CandidateIcon({ candidate }: { candidate: GlobalSearchCandidate }) {
	if (candidate.kind === "page") {
		const Icon = candidate.icon ?? Search;
		return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
	}
	if (candidate.kind === "project") {
		return <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
	}
	// The same tiles the canvas, board and link trails draw, so a work item is
	// recognizable as its kind before the label is read.
	return <RoadmapNodeGlyph kind={candidate.type} size={14} />;
}
