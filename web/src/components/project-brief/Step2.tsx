import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, X } from "lucide-react";
import { useId, useState } from "react";
import { supabase } from "@/lib/supabase";
import { TileOption } from "./TileOption";
import type { FormData } from "./types";

interface Step2Props {
	formData: FormData;
	updateFormData: (updates: Partial<FormData>) => void;
	compact?: boolean; // For modal vs full-page styling
}

export function Step2({
	formData,
	updateFormData,
	compact = false,
}: Step2Props) {
	const skillsInputId = useId();
	const [skillInput, setSkillInput] = useState("");
	const [showDropdown, setShowDropdown] = useState(false);

	const { data: skillsData } = useQuery({
		queryKey: ["skills"],
		queryFn: async () => {
			const { data, error } = await supabase
				.from("skills")
				.select("name, slug")
				.order("name");

			if (error) throw error;
			return data as { name: string; slug: string }[];
		},
	});

	const generalSkills = skillsData?.map((s) => s.name) || [
		"Graphic Design",
		"Content Writing",
		"Web Development",
		"Data Entry",
		"Digital Marketing",
		"Project Management",
		"Translation",
		"Video Editing",
		"SEO",
		"Social Media Marketing",
		"Virtual Assistant",
		"Illustration",
		"3D Modeling",
		"Voice Over",
		"Customer Service",
		"Accounting",
		"Legal Consulting",
		"HR & Recruiting",
		"Photography",
		"Videography",
	];

	const filteredSkills = generalSkills.filter(
		(skill) =>
			skill.toLowerCase().includes(skillInput.toLowerCase()) &&
			!formData.skills.includes(skill),
	);

	const addSkill = (skill: string) => {
		const existingSkill = generalSkills.find(
			(s) => s.toLowerCase() === skill.toLowerCase(),
		);

		if (existingSkill) {
			if (!formData.skills.includes(existingSkill)) {
				updateFormData({ skills: [...formData.skills, existingSkill] });
			}
		} else {
			const isDuplicateCustom = formData.customSkills.some(
				(s) => s.toLowerCase() === skill.toLowerCase(),
			);

			if (!isDuplicateCustom) {
				updateFormData({ customSkills: [...formData.customSkills, skill] });
			}
		}
		setSkillInput("");
		setShowDropdown(false);
	};

	const removeSkill = (skill: string) => {
		if (formData.skills.includes(skill)) {
			updateFormData({ skills: formData.skills.filter((s) => s !== skill) });
		}
		if (formData.customSkills.includes(skill)) {
			updateFormData({
				customSkills: formData.customSkills.filter((s) => s !== skill),
			});
		}
	};

	const spacing = compact ? "space-y-3" : "space-y-4";
	const inputPadding = compact ? "px-3 py-1.5" : "px-3 py-2";
	const inputSize = compact ? "text-sm" : "";
	const labelSize = compact ? "text-sm mb-1.5" : "text-sm mb-2";
	const skillChipPadding = compact ? "px-3 py-1" : "px-4 py-1.5";
	const skillChipSize = compact ? "text-xs" : "text-sm";
	const skillChipGap = compact ? "gap-1.5" : "gap-2";
	const skillIconSize = compact ? "w-3 h-3" : "w-3 h-3";
	const suggestionSize = compact ? "text-[11px]" : "text-xs";
	const suggestionPadding = compact ? "px-2.5 py-1" : "px-3 py-1";
	const gridGap = compact ? "gap-3" : "gap-4";
	const iconTopPosition = compact ? "top-2" : "top-2.5";
	const iconSize = compact ? "w-4 h-4" : "w-5 h-5";
	const dropdownPadding = compact ? "px-3 py-1.5" : "px-4 py-2";
	const marginBottom = compact ? "mb-3" : "mb-4";
	const popularMarginTop = compact ? "mt-3" : "mt-4";
	const popularMarginBottom = compact ? "mb-1.5" : "mb-2";

	return (
		<div className={spacing}>
			{/* Skills */}
			<div className="relative">
				<label
					htmlFor={skillsInputId}
					className={`block font-semibold text-foreground ${labelSize}`}
				>
					What skills or tools are required?
				</label>
				<div className="relative">
					<input
						id={skillsInputId}
						type="text"
						placeholder="Search skills (e.g. Graphic Design, Writing)"
						value={skillInput}
						onChange={(e) => {
							setSkillInput(e.target.value);
							setShowDropdown(true);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" && skillInput.trim()) {
								e.preventDefault();
								addSkill(skillInput.trim());
							}
						}}
						onFocus={() => setShowDropdown(true)}
						onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
						className={`w-full ${inputPadding} ${inputSize} ${marginBottom} rounded-lg border border-input bg-card pr-10 text-card-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/25`}
					/>
					<div
						className={`absolute right-3 ${iconTopPosition} transition-colors duration-200 pointer-events-none ${
							skillInput.trim() ? "text-primary" : "text-muted-foreground/50"
						}`}
					>
						<CornerDownLeft className={iconSize} />
					</div>
					{showDropdown && skillInput && filteredSkills.length > 0 && (
						<div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
							{filteredSkills.map((skill) => (
								<button
									type="button"
									key={skill}
									onClick={() => addSkill(skill)}
									className={`w-full text-left ${dropdownPadding} ${inputSize} text-popover-foreground transition-colors hover:bg-muted`}
								>
									{skill}
								</button>
							))}
						</div>
					)}
				</div>

				{/* Selected Skills */}
				<div className={`flex flex-wrap ${skillChipGap}`}>
					{[...formData.skills, ...formData.customSkills].map((skill) => (
						<button
							type="button"
							key={skill}
							className={`${skillChipPadding} flex cursor-pointer items-center ${skillChipGap} rounded-full border border-border bg-card text-card-foreground shadow-sm transition-colors hover:border-destructive hover:text-destructive ${skillChipSize} group`}
							onClick={() => removeSkill(skill)}
						>
							{skill}
							<X
								className={`${skillIconSize} text-muted-foreground transition-colors group-hover:text-destructive`}
							/>
						</button>
					))}
				</div>

				{/* Popular Suggestions */}
				<div className={popularMarginTop}>
					<p
						className={`${suggestionSize} text-muted-foreground ${popularMarginBottom} font-medium`}
					>
						Popular Skills
					</p>
					<div className={`flex flex-wrap ${skillChipGap}`}>
						{generalSkills
							.filter((skill) => !formData.skills.includes(skill))
							.slice(0, 14)
							.map((skill) => (
								<button
									type="button"
									key={skill}
									onClick={() => addSkill(skill)}
									className={`${suggestionPadding} rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary ${suggestionSize}`}
								>
									+ {skill}
								</button>
							))}
					</div>
				</div>
			</div>

			{/* Expected Duration */}
			<div>
				<p
					className={`block font-semibold text-foreground ${compact ? "text-sm mb-2.5" : "text-sm mb-4"}`}
				>
					Expected Duration
				</p>
				<div className={`grid grid-cols-2 ${gridGap}`}>
					<TileOption
						name="duration"
						value="<1_month"
						label="Less than 1 month"
						checked={formData.duration === "<1_month"}
						onChange={() => updateFormData({ duration: "<1_month" })}
						compact={compact}
					/>
					<TileOption
						name="duration"
						value="1-3_months"
						label="1-3 months"
						checked={formData.duration === "1-3_months"}
						onChange={() => updateFormData({ duration: "1-3_months" })}
						compact={compact}
					/>
					<TileOption
						name="duration"
						value="3-6_months"
						label="3-6 months"
						checked={formData.duration === "3-6_months"}
						onChange={() => updateFormData({ duration: "3-6_months" })}
						compact={compact}
					/>
					<TileOption
						name="duration"
						value="6+_months"
						label="More than 6 months"
						checked={formData.duration === "6+_months"}
						onChange={() => updateFormData({ duration: "6+_months" })}
						compact={compact}
					/>
				</div>
			</div>
		</div>
	);
}
