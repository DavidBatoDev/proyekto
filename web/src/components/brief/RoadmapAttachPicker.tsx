import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Map as MapIcon, X } from "lucide-react";
import { useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import type { PostingRoadmapSummary } from "@/services/postings.service";
import { roadmapService } from "@/services/roadmap.service";

/**
 * Attach one of the author's roadmaps to a brief.
 *
 * Attaching is a REFERENCE, not a grant: a consultant reading the brief sees the
 * roadmap's name and how big it is, never its contents. Letting a posting hand
 * out roadmap access would invent a second authorization path beside
 * `project_access` and `roadmap_shares`, which is the one thing this feature
 * must not do.
 *
 * The logic here is `LinkRoadmapModal`'s — its markup is not reused because that
 * file is hardcoded light-mode (`bg-white`, `text-gray-*`, literal hex) and
 * would break in the dark theme.
 */
export function RoadmapAttachPicker({
	roadmapId,
	roadmap,
	onChange,
	disabled,
}: {
	roadmapId: string | null;
	roadmap: PostingRoadmapSummary | null;
	onChange: (roadmapId: string | null) => void;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);

	if (roadmapId) {
		return (
			<div className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
				<MapIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
				<div className="min-w-0 flex-1">
					<p className="truncate text-[13px] font-medium text-foreground">
						{roadmap?.name ?? "Attached roadmap"}
					</p>
					{roadmap && (
						<p className="mt-0.5 text-[11.5px] text-muted-foreground">
							{roadmap.epic_count} epics · {roadmap.feature_count} features ·{" "}
							{roadmap.task_count} tasks
						</p>
					)}
					<p className="mt-1 text-[11.5px] text-muted-foreground">
						Consultants see the shape, not the contents.
					</p>
				</div>
				{!disabled && (
					<button
						type="button"
						onClick={() => onChange(null)}
						aria-label="Detach roadmap"
						className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				)}
			</div>
		);
	}

	return (
		<>
			<button
				type="button"
				disabled={disabled}
				onClick={() => setOpen(true)}
				className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
			>
				<MapIcon className="h-3.5 w-3.5" />
				Attach a roadmap
			</button>
			{open && (
				<RoadmapPickerDialog
					onClose={() => setOpen(false)}
					onPick={(id) => {
						onChange(id);
						setOpen(false);
					}}
				/>
			)}
		</>
	);
}

function RoadmapPickerDialog({
	onClose,
	onPick,
}: {
	onClose: () => void;
	onPick: (roadmapId: string) => void;
}) {
	const [selected, setSelected] = useState<string | null>(null);
	const roadmapsQuery = useQuery({
		queryKey: ["roadmaps", "all"] as const,
		queryFn: () => roadmapService.getAll(),
		staleTime: 30 * 1000,
	});

	const roadmaps = roadmapsQuery.data ?? [];

	return (
		<AppDialog
			open
			onClose={onClose}
			title="Attach a roadmap"
			description="Give consultants a sense of the shape of the work. They see its name and size, not its contents."
			size="md"
			footer={
				<div className="flex justify-end gap-3">
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg border border-input px-5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/40"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={!selected}
						onClick={() => selected && onPick(selected)}
						className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
					>
						Attach
					</button>
				</div>
			}
		>
			{roadmapsQuery.isPending ? (
				<p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					Loading your roadmaps…
				</p>
			) : roadmaps.length === 0 ? (
				<p className="py-6 text-center text-sm text-muted-foreground">
					You do not have any roadmaps yet.
				</p>
			) : (
				<div className="divide-y divide-border">
					{roadmaps.map((roadmap) => (
						<button
							key={roadmap.id}
							type="button"
							role="radio"
							aria-checked={selected === roadmap.id}
							onClick={() => setSelected(roadmap.id)}
							className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-muted/40"
						>
							<span
								className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
									selected === roadmap.id
										? "border-primary bg-primary"
										: "border-input"
								}`}
							>
								{selected === roadmap.id && (
									<Check className="h-2.5 w-2.5 text-primary-foreground" />
								)}
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium text-foreground">
									{roadmap.name}
								</span>
								{roadmap.description && (
									<span className="mt-0.5 block truncate text-xs text-muted-foreground">
										{roadmap.description}
									</span>
								)}
							</span>
						</button>
					))}
				</div>
			)}
		</AppDialog>
	);
}
