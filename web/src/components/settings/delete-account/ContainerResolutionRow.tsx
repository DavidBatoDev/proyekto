import { AlertTriangle, Check, Users } from "lucide-react";
import { useMemo, useState } from "react";
import {
	SettingsAvatar,
	settingsButton,
	settingsInput,
} from "@/components/workspace/settings/SettingsPrimitives";
import { deletionCopy } from "@/lib/accountDeletionCopy";
import { cn } from "@/lib/utils";
import type {
	ContainerResolution,
	DeletionDecision,
} from "@/services/accountDeletion.service";

/**
 * One workspace or team that needs a decision.
 *
 * Three states, and only one of them is tall at a time. That is the whole
 * answer to "twenty containers is a wall of forms": a decided row collapses to
 * a single line, so the undecided ones visually dominate whatever the length of
 * the list.
 *
 * Neither option is pre-selected. A default on an irreversible choice is a
 * default somebody tabs past.
 */
export function ContainerResolutionRow({
	decision,
	resolution,
	onChange,
}: {
	decision: DeletionDecision;
	resolution: ContainerResolution | undefined;
	onChange: (next: ContainerResolution | undefined) => void;
}) {
	const [open, setOpen] = useState(true);
	const [filter, setFilter] = useState("");

	const decided =
		resolution !== undefined &&
		(resolution.action === "delete" ||
			(resolution.action === "transfer" && Boolean(resolution.new_owner_id)));

	const candidates = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		if (!needle) return decision.candidates;
		return decision.candidates.filter((candidate) => {
			const name = (candidate.display_name ?? "").toLowerCase();
			const email = (candidate.email ?? "").toLowerCase();
			return name.includes(needle) || email.includes(needle);
		});
	}, [decision.candidates, filter]);

	const chosen = decision.candidates.find(
		(candidate) => candidate.user_id === resolution?.new_owner_id,
	);

	const kindLabel = decision.kind === "workspace" ? "Workspace" : "Team";

	// Collapsed summary.
	if (decided && !open) {
		return (
			<li className="flex items-center justify-between gap-3 border-b border-border px-1 py-3 last:border-b-0">
				<div className="flex min-w-0 items-center gap-3">
					<Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
					<div className="min-w-0">
						<p className="truncate text-sm font-medium text-foreground">
							{decision.name}
						</p>
						<p className="truncate text-xs text-muted-foreground">
							{kindLabel}
						</p>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-3">
					<span
						className={cn(
							"text-sm",
							resolution?.action === "delete"
								? "text-destructive"
								: "text-muted-foreground",
						)}
					>
						{resolution?.action === "delete"
							? "Will be deleted"
							: `${chosen?.display_name ?? "Someone"} will own it`}
					</span>
					<button
						type="button"
						className={settingsButton.link}
						onClick={() => setOpen(true)}
					>
						Change
					</button>
				</div>
			</li>
		);
	}

	return (
		<li className="border-b border-border px-1 py-4 last:border-b-0">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-sm font-medium text-foreground">{decision.name}</p>
					<p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
						<Users className="h-3.5 w-3.5" aria-hidden />
						{kindLabel} &middot; {decision.member_count} members
						{decision.project_count !== undefined
							? ` · ${decision.project_count} projects`
							: ""}
					</p>
				</div>

				<div className="flex shrink-0 rounded-lg border border-border p-0.5">
					<button
						type="button"
						aria-pressed={resolution?.action === "transfer"}
						onClick={() =>
							onChange({
								kind: decision.kind,
								id: decision.id,
								action: "transfer",
								new_owner_id: resolution?.new_owner_id,
							})
						}
						className={cn(
							"rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
							resolution?.action === "transfer"
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						Give it to someone
					</button>
					<button
						type="button"
						disabled={!decision.can_delete}
						aria-pressed={resolution?.action === "delete"}
						onClick={() => {
							onChange({
								kind: decision.kind,
								id: decision.id,
								action: "delete",
							});
							setOpen(false);
						}}
						className={cn(
							"rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
							resolution?.action === "delete"
								? "bg-destructive text-destructive-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						Delete it
					</button>
				</div>
			</div>

			{!decision.can_delete ? (
				<p className="mt-2 text-xs text-muted-foreground">
					{deletionCopy.cannotDeleteReason}
				</p>
			) : null}

			{resolution?.action === "transfer" ? (
				<div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
					{decision.candidates.length > 6 ? (
						<input
							type="text"
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
							placeholder="Filter by name or email"
							className={cn(settingsInput, "mb-3")}
						/>
					) : null}

					<ul className="max-h-64 space-y-1 overflow-y-auto">
						{candidates.map((candidate, index) => (
							<li key={candidate.user_id}>
								<label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted">
									<input
										type="radio"
										name={`successor-${decision.id}`}
										className="h-4 w-4 accent-primary"
										checked={resolution.new_owner_id === candidate.user_id}
										onChange={() => {
											onChange({
												kind: decision.kind,
												id: decision.id,
												action: "transfer",
												new_owner_id: candidate.user_id,
											});
											setOpen(false);
										}}
									/>
									<SettingsAvatar
										name={candidate.display_name ?? "Member"}
										src={candidate.avatar_url}
									/>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm font-medium text-foreground">
											{candidate.display_name ?? "Member"}
										</span>
										<span className="block truncate text-xs text-muted-foreground">
											{candidate.email}
										</span>
									</span>
									<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
										{candidate.role}
									</span>
									{/* Badged, not pre-selected: a suggestion, not a default. */}
									{index === 0 && !filter ? (
										<span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
											Suggested
										</span>
									) : null}
								</label>
							</li>
						))}
					</ul>

					<p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
						<AlertTriangle
							className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
							aria-hidden
						/>
						{deletionCopy.successorWarning(
							chosen?.display_name ?? "Whoever you choose",
						)}
					</p>
				</div>
			) : null}

			{resolution?.action === "delete" ? (
				<p className="mt-3 flex items-start gap-2 text-xs text-destructive">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
					{deletionCopy.deleteContainerWarning(
						decision.name,
						decision.member_count,
					)}
				</p>
			) : null}
		</li>
	);
}
