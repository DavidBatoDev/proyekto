import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Avatar } from "@/components/common/Avatar";
import { useProjectMembersQuery } from "@/hooks/useProjectQueries";
import { ACTION_FAMILIES, ACTION_FAMILY_LABELS } from "./activityCatalog";
import {
	DATE_PRESETS,
	DATE_PRESET_LABELS,
	type DatePreset,
	type LogsSearch,
	type ResolvedLogsSearch,
	hasActiveLogsFilters,
	toggleInList,
} from "./logsSearch";

function FilterSection({
	title,
	defaultOpen = false,
	count,
	children,
}: {
	title: string;
	defaultOpen?: boolean;
	count?: number;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const Chevron = open ? ChevronDown : ChevronRight;

	return (
		<div className="border-b border-border/60">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
			>
				<Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<span className="flex-1">{title}</span>
				{count ? (
					<span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
						{count}
					</span>
				) : null}
			</button>
			{open ? <div className="px-3 pb-3">{children}</div> : null}
		</div>
	);
}

function CheckRow({
	checked,
	onToggle,
	children,
}: {
	checked: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	return (
		<label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm text-foreground transition-colors hover:bg-muted/60">
			<input
				type="checkbox"
				checked={checked}
				onChange={onToggle}
				className="h-3.5 w-3.5 shrink-0 rounded border-input accent-primary"
			/>
			<span className="min-w-0 flex-1 truncate">{children}</span>
		</label>
	);
}

export function LogsFilterSidebar({
	projectId,
	value,
	onChange,
	onReset,
}: {
	projectId: string;
	value: ResolvedLogsSearch;
	onChange: (next: Partial<LogsSearch>) => void;
	onReset: () => void;
}) {
	const membersQuery = useProjectMembersQuery(projectId);
	const members = (membersQuery.data ?? []).filter((m) => m.user_id);
	const dirty = hasActiveLogsFilters(value);

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center justify-between border-b border-border px-3 py-3">
				<h2 className="text-sm font-semibold text-foreground">Filters</h2>
				<button
					type="button"
					onClick={onReset}
					disabled={!dirty}
					className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
				>
					Reset
				</button>
			</div>

			{/* hide-scrollbar keeps the rail scrollable without the chrome —
			    same treatment as the app's main sidebar. */}
			<div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto">
				<FilterSection title="Timeline" defaultOpen>
					<div className="flex flex-col gap-1">
						{DATE_PRESETS.map((preset) => (
							<label
								key={preset}
								className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-muted/60"
							>
								<input
									type="radio"
									name="logs-since"
									checked={value.since === preset}
									onChange={() => onChange({ since: preset as DatePreset })}
									className="h-3.5 w-3.5 shrink-0 accent-primary"
								/>
								<span>{DATE_PRESET_LABELS[preset]}</span>
							</label>
						))}
					</div>
				</FilterSection>

				<FilterSection
					title="Activity type"
					defaultOpen
					count={value.family.length}
				>
					<div className="flex flex-col gap-0.5">
						{ACTION_FAMILIES.map((family) => (
							<CheckRow
								key={family}
								checked={value.family.includes(family)}
								onToggle={() =>
									onChange({ family: toggleInList(value.family, family) })
								}
							>
								{ACTION_FAMILY_LABELS[family] ?? family}
							</CheckRow>
						))}
					</div>
				</FilterSection>

				<FilterSection title="People" count={value.actor.length}>
					{membersQuery.isPending ? (
						<p className="px-1.5 py-1 text-xs text-muted-foreground">
							Loading members…
						</p>
					) : members.length === 0 ? (
						<p className="px-1.5 py-1 text-xs text-muted-foreground">
							No members to filter by.
						</p>
					) : (
						<div className="flex flex-col gap-0.5">
							{members.map((member) => (
								<CheckRow
									key={member.id}
									checked={value.actor.includes(member.user_id as string)}
									onToggle={() =>
										onChange({
											actor: toggleInList(
												value.actor,
												member.user_id as string,
											),
										})
									}
								>
									<span className="flex items-center gap-2">
										<Avatar
											user={member.user as never}
											fallbackId={member.user_id ?? undefined}
											size="xs"
										/>
										<span className="truncate">
											{member.user?.display_name ||
												member.user?.email ||
												"Unknown member"}
										</span>
									</span>
								</CheckRow>
							))}
						</div>
					)}
					{/*
					 * Actors come from the current member list, so someone who has
					 * since left the project still has log rows but cannot be
					 * selected here. Surfacing that beats silently under-filtering.
					 */}
					<p className="mt-2 px-1.5 text-[11px] leading-snug text-muted-foreground">
						Only current members are listed.
					</p>
				</FilterSection>
			</div>
		</div>
	);
}
