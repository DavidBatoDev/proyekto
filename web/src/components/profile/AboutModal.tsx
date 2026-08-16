/**
 * AboutModal — combined bio + skills editor
 * Fetches all skills from /meta/skills, lets the user pick them with proficiency levels,
 * and saves both bio and the full skills list in one action.
 */

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	profileService,
	type SkillMeta,
	type UserSkill,
} from "@/services/profile.service";
import { ProfileModal } from "./ProfileModal";

type ProficiencyLevel = "beginner" | "intermediate" | "advanced" | "expert";

interface SkillEntry {
	skill_id: string;
	skill_name: string;
	skill_category?: string;
	proficiency_level: ProficiencyLevel;
}

interface Props {
	isOpen: boolean;
	onClose: () => void;
	initialBio: string;
	currentSkills: UserSkill[];
	onSave: (bio: string, skills: SkillEntry[]) => void;
	isSaving?: boolean;
}

const PROFICIENCY_OPTIONS: {
	value: ProficiencyLevel;
	label: string;
	color: string;
}[] = [
	{ value: "beginner", label: "Beginner", color: "text-gray-500 bg-gray-100" },
	{
		value: "intermediate",
		label: "Intermediate",
		color: "text-amber-700 bg-amber-50",
	},
	{
		value: "advanced",
		label: "Advanced",
		color: "text-orange-700 bg-orange-50",
	},
	{ value: "expert", label: "Expert", color: "text-green-700 bg-green-50" },
];

function ProficiencySelect({
	value,
	onChange,
}: {
	value: ProficiencyLevel;
	onChange: (v: ProficiencyLevel) => void;
}) {
	const current = PROFICIENCY_OPTIONS.find((o) => o.value === value)!;
	return (
		<div className="relative">
			<select
				value={value}
				onChange={(e) => onChange(e.target.value as ProficiencyLevel)}
				className={`text-xs font-medium px-2 py-0.5 rounded-full border-0 appearance-none pr-5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#ff9933]/50 ${current.color}`}
			>
				{PROFICIENCY_OPTIONS.map((o) => (
					<option key={o.value} value={o.value}>
						{o.label}
					</option>
				))}
			</select>
			<ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 pointer-events-none opacity-50" />
		</div>
	);
}

export function AboutModal({
	isOpen,
	onClose,
	initialBio,
	currentSkills,
	onSave,
	isSaving,
}: Props) {
	const [bio, setBio] = useState(initialBio);
	const [skills, setSkills] = useState<SkillEntry[]>([]);
	const [search, setSearch] = useState("");
	const [showPicker, setShowPicker] = useState(false);

	// Load meta skills
	const { data: metaSkills = [], isLoading: loadingMeta } = useQuery({
		queryKey: ["meta-skills"],
		queryFn: () => profileService.getAllSkills(),
		staleTime: 5 * 60 * 1000,
	});

	// Initialise from current profile skills whenever modal opens
	useEffect(() => {
		if (isOpen) {
			setBio(initialBio);
			setSkills(
				currentSkills.map((s) => ({
					skill_id: s.skill.id,
					skill_name: s.skill.name,
					skill_category: s.skill.category,
					proficiency_level: s.proficiency_level,
				})),
			);
			setSearch("");
			setShowPicker(false);
		}
	}, [isOpen, initialBio, currentSkills]);

	// Skills available to add (exclude already added)
	const addedIds = new Set(skills.map((s) => s.skill_id));
	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return metaSkills.filter(
			(m) =>
				!addedIds.has(m.id) &&
				(!q ||
					m.name.toLowerCase().includes(q) ||
					m.category?.toLowerCase().includes(q)),
		);
	}, [metaSkills, addedIds, search]);

	// Group remaining by category for the picker
	const grouped = useMemo(() => {
		const map = new Map<string, SkillMeta[]>();
		for (const s of filtered) {
			const cat = s.category ?? "Other";
			if (!map.has(cat)) map.set(cat, []);
			map.get(cat)!.push(s);
		}
		return map;
	}, [filtered]);

	const addSkill = (meta: SkillMeta) => {
		setSkills((prev) => [
			...prev,
			{
				skill_id: meta.id,
				skill_name: meta.name,
				skill_category: meta.category,
				proficiency_level: "intermediate",
			},
		]);
	};

	const removeSkill = (id: string) =>
		setSkills((prev) => prev.filter((s) => s.skill_id !== id));

	const updateProficiency = (id: string, level: ProficiencyLevel) => {
		setSkills((prev) =>
			prev.map((s) =>
				s.skill_id === id ? { ...s, proficiency_level: level } : s,
			),
		);
	};

	const handleSave = () => {
		onSave(bio, skills);
	};

	return (
		<ProfileModal
			isOpen={isOpen}
			onClose={onClose}
			title="Edit About & Skills"
			width="lg"
		>
			<div className="space-y-6">
				{/* ── Bio ─────────────────────────────────────────────────────────── */}
				<div>
					<label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
						About / Overview
					</label>
					<textarea
						value={bio}
						onChange={(e) => setBio(e.target.value)}
						rows={5}
						maxLength={2000}
						className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#ff9933]/50 resize-y"
						placeholder="Write a professional summary of your experience, expertise, and what makes you stand out…"
					/>
					<p className="text-xs text-gray-400 text-right mt-0.5">
						{2000 - bio.length} characters left
					</p>
				</div>

				{/* ── Current skills ───────────────────────────────────────────────── */}
				<div>
					<div className="flex items-center justify-between mb-2">
						<label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
							Skills
						</label>
						<button
							onClick={() => setShowPicker((p) => !p)}
							className="flex items-center gap-1 text-xs font-semibold text-[#ff9933] hover:underline"
						>
							<Plus className="w-3.5 h-3.5" />
							Add skill
						</button>
					</div>

					{/* Skill chips — current */}
					{skills.length > 0 ? (
						<div className="flex flex-wrap gap-2 mb-3">
							{skills.map((s) => {
								return (
									<div
										key={s.skill_id}
										className="flex items-center gap-1.5 pl-3 pr-1 py-1 bg-gray-100 rounded-full group"
									>
										<span className="text-sm text-gray-800 font-medium">
											{s.skill_name}
										</span>
										<ProficiencySelect
											value={s.proficiency_level}
											onChange={(lv) => updateProficiency(s.skill_id, lv)}
										/>
										<button
											onClick={() => removeSkill(s.skill_id)}
											className="w-4 h-4 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
										>
											<X className="w-3 h-3" />
										</button>
									</div>
								);
							})}
						</div>
					) : (
						<p className="text-sm text-gray-400 italic mb-3">
							No skills added yet. Click "Add skill" to get started.
						</p>
					)}

					{/* ── Skill picker dropdown ──────────────────────────────────────── */}
					{showPicker && (
						<div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
							{/* Search bar */}
							<div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50">
								<Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
								<input
									autoFocus
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									placeholder="Search skills…"
									className="flex-1 bg-transparent text-sm focus:outline-none"
								/>
								{search && (
									<button
										onClick={() => setSearch("")}
										className="text-gray-400 hover:text-gray-600"
									>
										<X className="w-3.5 h-3.5" />
									</button>
								)}
							</div>

							{/* Results */}
							<div className="max-h-56 overflow-y-auto">
								{loadingMeta ? (
									<div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
										<Loader2 className="w-4 h-4 animate-spin" /> Loading skills…
									</div>
								) : filtered.length === 0 ? (
									<p className="text-center py-6 text-sm text-gray-400">
										{search
											? "No matching skills found."
											: "All available skills are already added."}
									</p>
								) : (
									Array.from(grouped.entries()).map(([category, items]) => (
										<div key={category}>
											<p className="px-3 pt-2.5 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
												{category}
											</p>
											{items.map((skill) => (
												<button
													key={skill.id}
													onClick={() => addSkill(skill)}
													className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-[#ff9933]/5 hover:text-[#ff9933] transition-colors flex items-center gap-2"
												>
													<Plus className="w-3.5 h-3.5 shrink-0" />
													{skill.name}
												</button>
											))}
										</div>
									))
								)}
							</div>
						</div>
					)}
				</div>

				{/* ── Actions ─────────────────────────────────────────────────────── */}
				<div className="flex justify-end gap-3 pt-1 border-t border-gray-100">
					<button
						onClick={onClose}
						disabled={isSaving}
						className="px-5 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
					>
						Cancel
					</button>
					<button
						onClick={handleSave}
						disabled={isSaving}
						className="px-5 py-2 text-sm bg-[#ff9933] text-white rounded-lg hover:bg-[#e68829] disabled:opacity-60 transition-colors flex items-center gap-2"
					>
						{isSaving ? (
							<>
								<Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…
							</>
						) : (
							<>
								<Check className="w-3.5 h-3.5" /> Save changes
							</>
						)}
					</button>
				</div>
			</div>
		</ProfileModal>
	);
}
