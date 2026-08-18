import { useState } from "react";
import type { ConsultantPublicSkill } from "@/queries/consultants";

const VISIBLE = 5;

/**
 * Skill chips.
 *
 * Non-interactive on purpose: the expertise chips above these link to category
 * pages, and there is no skill-search surface to link to. A chip that looks
 * clickable and is not is worse than one that plainly is not.
 */
export function ConsultantSkills({
	skills,
	isOwner,
}: {
	skills: ConsultantPublicSkill[];
	isOwner: boolean;
}) {
	const [expanded, setExpanded] = useState(false);

	if (skills.length === 0) {
		if (!isOwner) return null;
		return (
			<p className="mt-3 text-[15px] text-muted-foreground">
				You have not added any skills yet.
			</p>
		);
	}

	const shown = expanded ? skills : skills.slice(0, VISIBLE);
	const hidden = skills.length - shown.length;

	return (
		<div className="mt-3 flex flex-wrap items-center gap-2">
			{shown.map((skill) => (
				<span
					key={skill.slug}
					title={
						skill.yearsExperience
							? `${skill.name} · ${skill.yearsExperience} yrs`
							: skill.name
					}
					className="rounded-full border border-border px-4 py-1.5 text-[14px] text-foreground"
				>
					{skill.name}
				</span>
			))}

			{hidden > 0 && (
				<button
					type="button"
					onClick={() => setExpanded(true)}
					className="px-1 text-[14px] font-medium text-foreground underline hover:text-primary"
				>
					+{hidden}
				</button>
			)}
			{expanded && skills.length > VISIBLE && (
				<button
					type="button"
					onClick={() => setExpanded(false)}
					className="px-1 text-[14px] font-medium text-foreground underline hover:text-primary"
				>
					Show less
				</button>
			)}
		</div>
	);
}
