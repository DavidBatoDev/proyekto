import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarClock } from "lucide-react";
import { AppDialog } from "@/components/common/AppDialog";
import { Avatar } from "@/components/common/Avatar";
import { RoadmapNodeGlyph } from "@/components/common/NodeGlyph";
import {
	CHANGE_REQUEST_STATUS_LABEL,
	changeRequestReference,
	crLinkSegments,
	timelineImpact,
} from "@/components/project/delivery/changeRequestModel";
import type { ChangeRequest } from "@/services/delivery.service";
import type { ProfileSummary } from "@/services/teams.service";
import { CrButton, CrStatusDot } from "./CrPrimitives";

/**
 * A peek at one request without leaving the queue.
 *
 * Triage means reading several in a row, and a full page navigation per request
 * loses your place in the list every time. The drawer answers "should I approve
 * this?" — the ask, the schedule claim, what it touches, and how it was decided —
 * and hands off to the full record for everything else.
 */
export function CrDrawer({
	request,
	projectId,
	requester,
	decider,
	onClose,
}: {
	request: ChangeRequest | null;
	projectId: string;
	requester: ProfileSummary | null;
	decider: ProfileSummary | null;
	onClose: () => void;
}) {
	if (!request) return null;

	const impact = timelineImpact(request.impact_timeline_days);
	const links = request.links ?? [];

	return (
		<AppDialog
			open
			onClose={onClose}
			variant="drawer-right"
			title={request.title}
			description={`${changeRequestReference(request)} · ${CHANGE_REQUEST_STATUS_LABEL[request.status]}`}
			footer={
				<Link
					to="/project/$projectId/change-requests/$changeRequestId"
					params={{ projectId, changeRequestId: request.id }}
					onClick={onClose}
				>
					<CrButton tone="primary">
						Open the full record
						<ArrowRight className="h-3.5 w-3.5" />
					</CrButton>
				</Link>
			}
		>
			{/* The schedule claim, first — it is what the reader is deciding about. */}
			<div className="rounded-md border border-border bg-muted/30 p-3">
				<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
					Schedule impact
				</p>
				<p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
					{impact ?? "Not stated"}
				</p>
				{(request.target_date_before || request.target_date_after) && (
					<p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
						<CalendarClock className="h-3.5 w-3.5 shrink-0" />
						<span className="line-through">
							{request.target_date_before ?? "—"}
						</span>
						<ArrowRight className="h-3 w-3 shrink-0" />
						<span className="font-medium text-foreground">
							{request.target_date_after ?? "—"}
						</span>
					</p>
				)}
			</div>

			<Section title="What is being asked for">
				{request.description ? (
					<p className="whitespace-pre-wrap text-sm text-foreground">
						{request.description}
					</p>
				) : (
					<Muted>No description.</Muted>
				)}
			</Section>

			<Section title="What changes in the plan">
				{request.impact_scope ? (
					<p className="whitespace-pre-wrap text-sm text-foreground">
						{request.impact_scope}
					</p>
				) : (
					<Muted>Not described.</Muted>
				)}
			</Section>

			<Section title={`Affects (${links.length})`}>
				{links.length === 0 ? (
					<Muted>Nothing linked.</Muted>
				) : (
					<ul className="flex flex-col gap-1.5">
						{links.map((link) => {
							const leaf = crLinkSegments(link).at(-1);
							if (!leaf) return null;
							return (
								<li
									key={link.id}
									className="flex items-center gap-1.5 text-sm text-foreground"
								>
									<RoadmapNodeGlyph kind={leaf.kind} size={12} />
									<span className="truncate">{leaf.title}</span>
								</li>
							);
						})}
					</ul>
				)}
			</Section>

			<Section title="Who">
				<div className="flex flex-col gap-2 text-sm">
					<Person label="Raised by" person={requester} />
					{request.decided_at && <Person label="Decided by" person={decider} />}
					<div className="flex items-center gap-2">
						<span className="w-20 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
							Status
						</span>
						<CrStatusDot
							status={request.status}
							label={CHANGE_REQUEST_STATUS_LABEL[request.status]}
						/>
					</div>
				</div>
				{request.decision_note && (
					<p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
						{request.decision_note}
					</p>
				)}
			</Section>

			{request.status === "approved" && (
				// The page's central point, restated where the decision is read.
				<p className="rounded-md border border-info/30 bg-info/10 p-2.5 text-xs text-foreground">
					Approved, but not yet on the roadmap. Applying is a separate step so
					the change goes through the normal review-and-commit path and cannot
					overwrite concurrent edits.
				</p>
			)}
		</AppDialog>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="mt-4 border-t border-border pt-3 first:mt-0 first:border-t-0 first:pt-0">
			<p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
				{title}
			</p>
			{children}
		</div>
	);
}

function Muted({ children }: { children: React.ReactNode }) {
	return <p className="text-sm text-muted-foreground/70">{children}</p>;
}

function Person({
	label,
	person,
}: {
	label: string;
	person: ProfileSummary | null;
}) {
	return (
		<div className="flex items-center gap-2">
			<span className="w-20 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
				{label}
			</span>
			{person ? (
				<span className="inline-flex items-center gap-1.5 text-foreground">
					<Avatar user={person} size="xs" />
					{person.display_name ?? "Someone"}
				</span>
			) : (
				<span className="text-muted-foreground/70">Unknown</span>
			)}
		</div>
	);
}
