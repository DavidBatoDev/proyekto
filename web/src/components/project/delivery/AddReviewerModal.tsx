import { Search, UserPlus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { Avatar } from "@/components/common/Avatar";
import { toProfileSummary } from "@/services/memberProfile";
import type { ProjectMember } from "@/services/project.service";
import type { ProfileSummary } from "@/services/teams.service";
import { inputClass, SecondaryButton } from "./DeliveryPrimitives";

/**
 * Names a project member as a required sign-off.
 *
 * Any member may be named — review is capability-based here, not tied to a
 * declared client or lead identity — so the list is the whole project, searchable.
 */
export function AddReviewerModal({
	isOpen,
	members,
	pending,
	onClose,
	onAdd,
}: {
	isOpen: boolean;
	/** Already filtered to members who aren't reviewers yet. */
	members: ProjectMember[];
	pending: boolean;
	onClose: () => void;
	/** The profile rides along so the optimistic row can show an avatar. */
	onAdd: (reviewerId: string, profile: ProfileSummary | null) => void;
}) {
	const [search, setSearch] = useState("");
	const searchRef = useRef<HTMLInputElement>(null);

	const matches = useMemo(() => {
		const needle = search.trim().toLowerCase();
		if (!needle) return members;
		return members.filter((member) =>
			(member.user?.display_name ?? "").toLowerCase().includes(needle),
		);
	}, [members, search]);

	const close = () => {
		setSearch("");
		onClose();
	};

	return (
		<AppDialog
			open={isOpen}
			onClose={close}
			busy={pending}
			initialFocusRef={searchRef}
			title="Add a reviewer"
			description="Every named reviewer must approve before the deliverable is accepted."
			footer={<SecondaryButton onClick={close}>Done</SecondaryButton>}
		>
			<div className="relative mb-3">
				<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<input
					ref={searchRef}
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					className={`${inputClass} pl-9`}
					placeholder="Search project members"
					aria-label="Search project members"
				/>
			</div>

			{members.length === 0 ? (
				<p className="py-8 text-center text-sm text-muted-foreground">
					Every project member is already a reviewer.
				</p>
			) : matches.length === 0 ? (
				<p className="py-8 text-center text-sm text-muted-foreground">
					Nobody matches “{search.trim()}”.
				</p>
			) : (
				<ul className="space-y-1">
					{matches.map((member) => (
						<li key={member.id}>
							<button
								type="button"
								disabled={pending || !member.user_id}
								onClick={() => {
									if (!member.user_id) return;
									onAdd(member.user_id, toProfileSummary(member));
									close();
								}}
								className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-muted disabled:opacity-50"
							>
								<Avatar
									user={toProfileSummary(member)}
									fallbackId={member.user_id ?? member.id}
									size="sm"
								/>
								<span className="min-w-0 flex-1 truncate text-sm text-foreground">
									{member.user?.display_name ?? "Member"}
								</span>
								<UserPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
							</button>
						</li>
					))}
				</ul>
			)}
		</AppDialog>
	);
}
