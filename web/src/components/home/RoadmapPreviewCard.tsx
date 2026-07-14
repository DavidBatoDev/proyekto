import { ChevronDown, ChevronRight, Layers3 } from "lucide-react";
import {
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	useState,
} from "react";

export type RoadmapCardFeature = {
	id: string;
	title: string;
	tasks?: unknown[];
};

export type RoadmapCardEpic = {
	id: string;
	title: string;
	position: number;
	features?: RoadmapCardFeature[];
	secondaryLabel?: string;
};

export type RoadmapPreviewCardProps = {
	variant: "roadmap" | "template";
	title: string;
	description: string;
	epics: RoadmapCardEpic[];
	selected?: boolean;
	onSelect?: () => void;
	menu?: ReactNode;
	status: ReactNode;
	footerLeading?: ReactNode;
	footerAction: ReactNode;
	className?: string;
	style?: CSSProperties;
};

const MAX_EPICS = 4;

export function EpicOverview({
	epics,
	selected = false,
	variant,
}: {
	epics: RoadmapCardEpic[];
	selected?: boolean;
	variant: RoadmapPreviewCardProps["variant"];
}) {
	const allEpics = [...epics].sort((a, b) => a.position - b.position);
	const [expandedEpicIds, setExpandedEpicIds] = useState<Set<string>>(() =>
		allEpics[0] ? new Set([allEpics[0].id]) : new Set(),
	);
	const displayedEpics = selected ? allEpics : allEpics.slice(0, MAX_EPICS);
	const remainingCount = allEpics.length - MAX_EPICS;

	const toggleEpic = (epicId: string) =>
		setExpandedEpicIds((current) => {
			const next = new Set(current);
			if (next.has(epicId)) next.delete(epicId);
			else next.add(epicId);
			return next;
		});

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="mb-2 flex items-center justify-between px-1">
				<div className="flex min-w-0 items-center gap-2">
					<div className="rounded-md bg-foreground p-1.5 text-background shadow-sm">
						<Layers3 className="h-3.5 w-3.5" />
					</div>
					<span className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-foreground">
						Roadmap epics
					</span>
				</div>
				<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
					{allEpics.length}
				</span>
			</div>

			{allEpics.length === 0 ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg bg-muted/60 px-4 text-center">
					<p className="text-xs font-semibold text-foreground">No epics yet</p>
					<p className="mt-1 text-[11px] leading-4 text-muted-foreground">
						Your roadmap is ready for its first delivery area.
					</p>
				</div>
			) : (
				<div
					className={`flex min-h-0 flex-1 flex-col gap-1 ${
						selected
							? "overflow-y-auto [scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-track]:my-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/50"
							: "overflow-y-auto [scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:transparent_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-transparent"
					}`}
				>
					{displayedEpics.map((epic, index) => {
						const features = epic.features ?? [];
						const featureCount = features.length;
						const showFeatures =
							selected && expandedEpicIds.has(epic.id) && featureCount > 0;
						const secondaryLabel =
							epic.secondaryLabel ??
							(epic.features
								? `${featureCount} ${featureCount === 1 ? "feature" : "features"}`
								: undefined);
						const rowContent = (
							<>
								<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-bold text-muted-foreground">
									{String(index + 1).padStart(2, "0")}
								</span>
								<div className="min-w-0 flex-1">
									<p className="truncate text-[12px] font-semibold leading-4 text-foreground">
										{epic.title}
									</p>
									{secondaryLabel ? (
										<p className="text-[10px] leading-3 text-muted-foreground">
											{secondaryLabel}
										</p>
									) : null}
								</div>
								{variant === "template" ? (
									<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
								) : featureCount > 0 ? (
									<ChevronDown
										className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
											showFeatures ? "" : "-rotate-90"
										}`}
									/>
								) : null}
							</>
						);

						return (
							<div key={epic.id} className="flex shrink-0 flex-col">
								{variant === "roadmap" ? (
									<button
										type="button"
										tabIndex={selected ? 0 : -1}
										onClick={(event) => {
											if (!selected) return;
											event.stopPropagation();
											toggleEpic(epic.id);
										}}
										className="flex h-14 w-full shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-left shadow-sm transition-colors hover:border-input hover:bg-muted"
									>
										{rowContent}
									</button>
								) : (
									<div className="flex h-14 w-full shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-left shadow-sm">
										{rowContent}
									</div>
								)}

								{showFeatures ? (
									<div className="ml-3 mt-1 flex flex-col gap-1 border-l border-border pl-3 duration-200 ease-out animate-in fade-in slide-in-from-top-1 motion-reduce:animate-none">
										{features.map((feature) => {
											const taskCount = feature.tasks?.length ?? 0;
											return (
												<div
													key={feature.id}
													className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5"
												>
													<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
													<p className="min-w-0 flex-1 truncate text-[11px] font-medium leading-4 text-foreground">
														{feature.title}
													</p>
													{taskCount > 0 ? (
														<span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[9px] font-semibold text-accent-foreground">
															{taskCount}
														</span>
													) : null}
												</div>
											);
										})}
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			)}

			{!selected && remainingCount > 0 ? (
				<div className="mt-2 border-t border-border pt-2 text-center">
					<span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
						+{remainingCount} more {remainingCount === 1 ? "epic" : "epics"}
					</span>
				</div>
			) : null}
		</div>
	);
}

export function RoadmapPreviewCard({
	variant,
	title,
	description,
	epics,
	selected = false,
	onSelect,
	menu,
	status,
	footerLeading,
	footerAction,
	className = "",
	style,
}: RoadmapPreviewCardProps) {
	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!onSelect || (event.key !== "Enter" && event.key !== " ")) return;
		event.preventDefault();
		onSelect();
	};

	return (
		// The wrapper is keyboard-interactive for saved roadmaps and presentational for templates.
		// biome-ignore lint/a11y/noStaticElementInteractions: semantics are selected through the optional role below
		// biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-pressed is only populated with the button role
		<div
			data-roadmap-card={variant === "roadmap" ? "" : undefined}
			data-roadmap-card-variant={variant}
			role={onSelect ? "button" : undefined}
			tabIndex={onSelect ? 0 : undefined}
			aria-pressed={onSelect ? selected : undefined}
			onClick={onSelect}
			onKeyDown={handleKeyDown}
			className={`group relative flex h-auto flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg sm:h-[420px] ${
				selected
					? "border-primary ring-2 ring-primary/45 shadow-lg dark:ring-primary/80"
					: "border-border hover:border-input"
			} ${onSelect ? "cursor-pointer" : ""} ${className}`}
			style={style}
		>
			{menu}
			<div className="flex h-full flex-col">
				<div className="h-[330px] overflow-hidden p-4">
					<EpicOverview epics={epics} selected={selected} variant={variant} />
				</div>
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-2.5">
					<div className="flex items-start justify-between gap-2">
						<h3 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-card-foreground">
							{title}
						</h3>
						{status}
					</div>
					<p className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">
						{description}
					</p>
					<div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2">
						{footerLeading ?? <span />}
						{footerAction}
					</div>
				</div>
			</div>
		</div>
	);
}
