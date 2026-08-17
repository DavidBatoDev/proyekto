import { useQuery } from "@tanstack/react-query";
import { Check, Info } from "lucide-react";
import { useState } from "react";
import { getRoadmapChanges } from "@/api/endpoints/roadmap";
import { AppDialog } from "@/components/common/AppDialog";
import { Avatar } from "@/components/common/Avatar";
import type { ChangeRequest } from "@/services/delivery.service";
import { changeRequestReference } from "./changeRequestModel";
import {
	FieldLabel,
	ListBox,
	ListEmpty,
	PrimaryButton,
	SecondaryButton,
} from "./DeliveryPrimitives";

/**
 * Recording that an approved change reached the roadmap.
 *
 * Approving a change request deliberately does not edit the roadmap: a request
 * approved days ago carries a stale revision token, so auto-applying it would
 * either 409 or blind-clobber whatever else has been committed since. The edit is
 * made on the roadmap through the normal path, and this dialog attaches the
 * resulting commit to the request.
 *
 * The commit is PICKED, not typed — `applied_change_id` has to reference a real
 * `roadmap_change_history` row, and the backend rejects one belonging to another
 * project.
 */
export function RecordAppliedModal({
	isOpen,
	request,
	roadmapId,
	pending,
	onClose,
	onRecord,
}: {
	isOpen: boolean;
	request: ChangeRequest;
	/** The roadmap whose history is offered. Null when none is linked yet. */
	roadmapId: string | null;
	pending: boolean;
	onClose: () => void;
	onRecord: (appliedChangeId: string) => void;
}) {
	const [selected, setSelected] = useState<string | null>(null);

	const changes = useQuery({
		queryKey: ["roadmap", "changes", roadmapId],
		queryFn: () => getRoadmapChanges(roadmapId as string, { limit: 15 }),
		enabled: isOpen && Boolean(roadmapId),
		staleTime: 15 * 1000,
	});

	const close = () => {
		setSelected(null);
		onClose();
	};

	// Discarded previews were never committed, so they cannot have carried
	// anything onto the roadmap.
	const applied = (changes.data ?? []).filter((c) => c.status === "applied");

	return (
		<AppDialog
			open={isOpen}
			onClose={close}
			busy={pending}
			size="lg"
			title="Record this as applied"
			description={`${changeRequestReference(request)} · ${request.title}`}
			footer={
				<>
					<SecondaryButton onClick={close} disabled={pending}>
						Cancel
					</SecondaryButton>
					<PrimaryButton
						onClick={() => selected && onRecord(selected)}
						disabled={!selected}
						loading={pending}
					>
						<Check className="h-4 w-4" />
						Mark as applied
					</PrimaryButton>
				</>
			}
		>
			<p className="mb-4 flex gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
				<Info className="mt-0.5 h-4 w-4 shrink-0" />
				<span>
					Make the change on the roadmap first, then pick the commit it
					produced. Approval never edits the roadmap for you — the change goes
					through the normal review-and-commit path so it cannot overwrite
					concurrent edits.
				</span>
			</p>

			{!roadmapId ? (
				<p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
					This change request is not attached to a roadmap, so there is no
					commit history to pick from.
				</p>
			) : (
				<>
					<FieldLabel>Recent roadmap commits</FieldLabel>
					<ListBox title="Newest first" meta={`${applied.length} shown`}>
						{changes.isPending && (
							<ListEmpty>Loading the roadmap's history…</ListEmpty>
						)}
						{changes.isError && (
							<ListEmpty>Couldn't load the roadmap's history.</ListEmpty>
						)}
						{!changes.isPending && !changes.isError && applied.length === 0 && (
							<ListEmpty>
								Nothing has been committed to this roadmap yet.
							</ListEmpty>
						)}
						{applied.map((change) => {
							const isSelected = selected === change.change_id;
							return (
								<button
									key={change.change_id}
									type="button"
									onClick={() => setSelected(change.change_id)}
									className={`flex w-full items-center gap-3 border-b border-border/60 px-4 py-2.5 text-left text-sm transition-colors last:border-b-0 ${
										isSelected ? "bg-primary/10" : "hover:bg-muted/40"
									}`}
								>
									<span
										aria-hidden
										className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
											isSelected
												? "border-primary bg-primary"
												: "border-muted-foreground/40"
										}`}
									>
										{isSelected && (
											<Check
												className="h-2.5 w-2.5 text-white"
												strokeWidth={3}
											/>
										)}
									</span>
									{/* The history rows carry only actor_id, so the avatar falls
									    back to initials from the id rather than fetching a profile
									    per row for a picker. */}
									<Avatar
										user={null}
										fallbackId={change.actor_id ?? undefined}
										size="xs"
									/>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-foreground">
											{change.semantic_change_count ??
												change.operations_count ??
												0}{" "}
											{(change.semantic_change_count ??
												change.operations_count ??
												0) === 1
												? "change"
												: "changes"}
										</span>
										<span className="block truncate font-mono text-[11px] text-muted-foreground">
											{change.change_id.slice(0, 8)}
										</span>
									</span>
									<span className="shrink-0 text-[11px] text-muted-foreground">
										{change.committed_at
											? new Date(change.committed_at).toLocaleString()
											: "—"}
									</span>
								</button>
							);
						})}
					</ListBox>
				</>
			)}
		</AppDialog>
	);
}
