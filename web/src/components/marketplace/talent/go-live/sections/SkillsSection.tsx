import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
	type ProficiencyLevel,
	profileService,
} from "@/services/profile.service";
import type { ImportedSkill } from "@/services/profileImport.service";

const LEVELS: ProficiencyLevel[] = [
	"beginner",
	"intermediate",
	"advanced",
	"expert",
];

/**
 * Skills, each with a proficiency.
 *
 * Skills travel by NAME here, not id. The catalogue only had 40 generic
 * entries, so an imported "Terraform" has no row to point at yet; the server
 * resolves or creates each name inside the import transaction. That also means
 * the picker offers suggestions rather than restricting the field — typing a
 * skill nobody has used before has to work.
 */
export function SkillsSection({
	skills,
	onChange,
}: {
	skills: ImportedSkill[];
	onChange: (next: ImportedSkill[]) => void;
}) {
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const catalogue = useQuery({
		queryKey: ["profileMeta", "skills"],
		queryFn: () => profileService.getAllSkills(),
		staleTime: 60 * 60 * 1000,
	});

	const taken = useMemo(
		() => new Set(skills.map((s) => s.name.toLowerCase())),
		[skills],
	);

	const suggestions = useMemo(() => {
		const term = query.trim().toLowerCase();
		if (!term) return [];
		return (catalogue.data ?? [])
			.filter(
				(skill) =>
					skill.name.toLowerCase().includes(term) &&
					!taken.has(skill.name.toLowerCase()),
			)
			.slice(0, 6);
	}, [catalogue.data, query, taken]);

	const add = (name: string) => {
		const clean = name.trim();
		if (!clean || taken.has(clean.toLowerCase())) {
			setQuery("");
			return;
		}
		onChange([...skills, { name: clean, proficiency_level: "intermediate" }]);
		setQuery("");
		inputRef.current?.focus();
	};

	return (
		<section>
			<h3 className="text-base font-semibold text-foreground">Skills</h3>
			<p className="mt-1 text-sm text-muted-foreground">
				These are what consultants search on, so be specific.
			</p>

			<div className="relative mt-4">
				<div className="flex gap-2">
					<input
						ref={inputRef}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								add(suggestions[0]?.name ?? query);
							}
						}}
						placeholder="Add a skill, e.g. Terraform"
						aria-label="Add a skill"
						className="w-full border-0 border-b border-input bg-transparent px-0 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-0"
					/>
					<button
						type="button"
						onClick={() => add(query)}
						disabled={!query.trim()}
						className="shrink-0 cursor-pointer rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
					>
						<Plus className="h-4 w-4" />
						<span className="sr-only">Add skill</span>
					</button>
				</div>

				{suggestions.length > 0 && (
					<ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
						{suggestions.map((skill) => (
							<li key={skill.id}>
								<button
									type="button"
									onClick={() => add(skill.name)}
									className="w-full cursor-pointer px-4 py-2 text-left text-sm text-popover-foreground transition-colors hover:bg-muted"
								>
									{skill.name}
								</button>
							</li>
						))}
					</ul>
				)}
			</div>

			{skills.length > 0 && (
				<ul className="mt-4 flex flex-wrap gap-2">
					{skills.map((skill, index) => (
						<li
							key={skill.name}
							className="group inline-flex items-center gap-2 rounded-full border border-border bg-card py-2 pl-4 pr-2 transition-colors hover:border-primary/40"
						>
							<span className="text-sm text-foreground">{skill.name}</span>
							{/*
							 * The level select is unstyled on purpose: inside a pill a
							 * bordered control would read as a second chip.
							 */}
							<select
								value={skill.proficiency_level ?? "intermediate"}
								onChange={(event) =>
									onChange(
										skills.map((item, i) =>
											i === index
												? {
														...item,
														proficiency_level: event.target
															.value as ProficiencyLevel,
													}
												: item,
										),
									)
								}
								aria-label={`Proficiency in ${skill.name}`}
								className="cursor-pointer border-0 bg-transparent p-0 text-xs capitalize text-muted-foreground outline-none focus:ring-0"
							>
								{LEVELS.map((level) => (
									<option key={level} value={level}>
										{level}
									</option>
								))}
							</select>
							<button
								type="button"
								onClick={() => onChange(skills.filter((_, i) => i !== index))}
								aria-label={`Remove ${skill.name}`}
								className="cursor-pointer rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								<X className="h-3 w-3" />
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
