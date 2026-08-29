import { Briefcase, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import {
	EditableItem,
	ItemControlButton,
} from "@/components/marketplace/profile/EditableSection";
import type { ConsultantPublicExperience } from "@/queries/consultants";

const DESCRIPTION_CLAMP = 220;

/**
 * Work history, in the shape the reference profile uses: role, then
 * company and arrangement, then the dated span with a duration, then a
 * clamped description.
 *
 * `onEditItem`/`onDeleteItem` are the WYSIWYG hooks: passed only when the
 * viewer owns the profile, in which case each row grows hover controls.
 * Without them a row's markup is exactly what it always was.
 */
export function ConsultantExperience({
	experiences,
	isOwner,
	name,
	onEditItem,
	onDeleteItem,
}: {
	experiences: ConsultantPublicExperience[];
	isOwner: boolean;
	name: string;
	onEditItem?: (entry: ConsultantPublicExperience) => void;
	onDeleteItem?: (entry: ConsultantPublicExperience) => void;
}) {
	if (experiences.length === 0) {
		return (
			<p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">
				{isOwner
					? "You have not added any work experience yet."
					: `${name} has not added work experience yet.`}
			</p>
		);
	}

	return (
		<ol className="mt-4 space-y-6">
			{experiences.map((entry) => (
				<li key={entry.id}>
					{onEditItem || onDeleteItem ? (
						<EditableItem
							controls={
								<div className="flex gap-1">
									{onEditItem && (
										<ItemControlButton
											label="Edit experience"
											onClick={() => onEditItem(entry)}
											icon={<Pencil className="h-3.5 w-3.5" />}
										/>
									)}
									{onDeleteItem && (
										<ItemControlButton
											label="Delete experience"
											onClick={() => onDeleteItem(entry)}
											icon={<Trash2 className="h-3.5 w-3.5" />}
										/>
									)}
								</div>
							}
						>
							<ExperienceRow entry={entry} />
						</EditableItem>
					) : (
						<ExperienceRow entry={entry} />
					)}
				</li>
			))}
		</ol>
	);
}

function ExperienceRow({ entry }: { entry: ConsultantPublicExperience }) {
	const [expanded, setExpanded] = useState(false);
	const description = entry.description?.trim() ?? "";
	const isLong = description.length > DESCRIPTION_CLAMP;

	const subtitle = [entry.company, entry.is_remote ? "Remote" : entry.location]
		.filter(Boolean)
		.join(" · ");

	return (
		<div className="flex gap-4">
			<span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
				<Briefcase className="h-4 w-4 text-muted-foreground" />
			</span>

			<div className="min-w-0">
				<h3 className="text-[15px] font-semibold text-foreground">
					{entry.title ?? "Role"}
				</h3>
				{subtitle && (
					<p className="text-[14px] text-muted-foreground">{subtitle}</p>
				)}
				<p className="text-[13px] text-muted-foreground">{formatSpan(entry)}</p>

				{description && (
					<p className="mt-2 max-w-2xl whitespace-pre-line text-[14px] leading-relaxed text-foreground">
						{isLong && !expanded
							? `${description.slice(0, DESCRIPTION_CLAMP).trimEnd()}… `
							: description}
						{isLong && (
							<button
								type="button"
								onClick={() => setExpanded((current) => !current)}
								aria-expanded={expanded}
								className="ml-1 font-medium text-foreground underline hover:text-primary"
							>
								{expanded ? "Read less" : "Read more"}
							</button>
						)}
					</p>
				)}
			</div>
		</div>
	);
}

/**
 * "Feb 2019 - Present · 7 yrs 6 mos".
 *
 * The duration is computed from whole months so it cannot drift by a day and
 * re-render differently; an ongoing role measures to today.
 */
function formatSpan(entry: ConsultantPublicExperience): string {
	const start = parseDate(entry.start_date);
	const end = entry.is_current ? new Date() : parseDate(entry.end_date);

	const startLabel = start ? formatMonthYear(start) : null;
	const endLabel = entry.is_current
		? "Present"
		: end
			? formatMonthYear(end)
			: null;

	const range = [startLabel, endLabel].filter(Boolean).join(" - ");
	if (!start || !end) return range;

	const months =
		(end.getFullYear() - start.getFullYear()) * 12 +
		(end.getMonth() - start.getMonth());
	if (months < 0) return range;

	const years = Math.floor(months / 12);
	const remainder = months % 12;
	const parts = [
		years > 0 ? `${years} yr${years === 1 ? "" : "s"}` : null,
		remainder > 0 ? `${remainder} mo${remainder === 1 ? "" : "s"}` : null,
	].filter(Boolean);

	return parts.length > 0 ? `${range} · ${parts.join(" ")}` : range;
}

function parseDate(value: string | null): Date | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function formatMonthYear(date: Date): string {
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		year: "numeric",
	}).format(date);
}
