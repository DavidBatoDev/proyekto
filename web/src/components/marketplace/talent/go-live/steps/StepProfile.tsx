import {
	Award,
	Briefcase,
	Camera,
	GraduationCap,
	MapPin,
	Sparkles,
} from "lucide-react";
import { useRef, useState } from "react";
import { CertificationModal } from "@/components/profile/CertificationModal";
import { EducationModal } from "@/components/profile/EducationModal";
import { ExperienceModal } from "@/components/profile/ExperienceModal";
import type { SpecializationCategory } from "@/services/profile.service";
import type {
	ImportedCertification,
	ImportedEducation,
	ImportedExperience,
} from "@/services/profileImport.service";
import { GoLiveCallout, GoLiveField } from "../GoLiveForm";
import type { DraftAction, ProfileDraft } from "../profileDraft";
import { EntityList } from "../sections/EntityList";
import { SkillsSection } from "../sections/SkillsSection";

const SPECIALIZATIONS: { value: SpecializationCategory; label: string }[] = [
	{ value: "fintech", label: "Fintech" },
	{ value: "healthcare", label: "Healthcare" },
	{ value: "e_commerce", label: "E-Commerce" },
	{ value: "saas", label: "SaaS" },
	{ value: "education", label: "Education" },
	{ value: "real_estate", label: "Real Estate" },
	{ value: "legal", label: "Legal" },
	{ value: "marketing", label: "Marketing" },
	{ value: "logistics", label: "Logistics" },
	{ value: "media", label: "Media" },
	{ value: "gaming", label: "Gaming" },
	{ value: "ai_ml", label: "AI / ML" },
	{ value: "cybersecurity", label: "Cybersecurity" },
	{ value: "blockchain", label: "Blockchain" },
	{ value: "other", label: "Other" },
];

const monthYear = (iso?: string) =>
	iso
		? new Date(iso).toLocaleDateString("en-US", {
				year: "numeric",
				month: "short",
			})
		: "";

type EditTarget = {
	kind: "experience" | "education" | "certification";
	index: number | null;
};

/**
 * Step 2: the profile itself.
 *
 * This is the step that fixes the original defect — the wizard never asked for
 * a headline, a bio or a country, all three of which the server requires before
 * it will publish anyone.
 */
export function StepProfile({
	draft,
	dispatch,
}: {
	draft: ProfileDraft;
	dispatch: React.Dispatch<DraftAction>;
}) {
	const [editing, setEditing] = useState<EditTarget | null>(null);
	const avatarInput = useRef<HTMLInputElement>(null);
	const set = (patch: Partial<ProfileDraft>) =>
		dispatch({ type: "set", patch });
	const isOtherIndustry = draft.specCategory === "other";

	/**
	 * Shows the image immediately from a local blob and defers the upload.
	 *
	 * The previous version uploaded on selection inside a try/finally with no
	 * catch, so a failed upload was swallowed and the avatar simply never
	 * appeared with nothing to explain why. Now the preview cannot fail, and the
	 * upload happens where the step is saved and errors reach a toast.
	 */
	const pickAvatar = (file: File | undefined) => {
		if (!file) return;
		if (!file.type.startsWith("image/")) return;
		// Release the previous preview; blob URLs live until the document is gone.
		if (draft.avatar_url?.startsWith("blob:")) {
			URL.revokeObjectURL(draft.avatar_url);
		}
		set({ avatar_url: URL.createObjectURL(file), avatarFile: file });
	};

	return (
		<div className="space-y-10">
			{draft.source !== "manual" && (
				<GoLiveCallout icon={<Sparkles className="h-5 w-5 text-primary" />}>
					<p className="font-medium text-foreground">
						We filled this in from your{" "}
						{draft.source === "cv_llm" ? "CV" : "LinkedIn export"}.
					</p>
					<p className="mt-0.5 text-muted-foreground">
						Read it through — nothing is saved until you continue.
					</p>
				</GoLiveCallout>
			)}

			{draft.warnings.map((warning) => (
				<GoLiveCallout key={warning} tone="caution">
					{warning}
				</GoLiveCallout>
			))}

			{/* Identity - laid out like the public profile header it produces. */}
			<section className="flex flex-col gap-5 sm:flex-row sm:items-start">
				<div className="relative shrink-0">
					{draft.avatar_url ? (
						<img
							src={draft.avatar_url}
							alt=""
							className="h-24 w-24 rounded-full object-cover"
						/>
					) : (
						<div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-3xl font-semibold text-primary-foreground">
							{draft.display_name.trim().charAt(0).toUpperCase() || "?"}
						</div>
					)}
					<button
						type="button"
						onClick={() => avatarInput.current?.click()}
						aria-label="Change your photo"
						className="absolute bottom-0 right-0 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground"
					>
						<Camera className="h-4 w-4" />
					</button>
					<input
						ref={avatarInput}
						type="file"
						accept="image/*"
						className="sr-only"
						onChange={(event) => pickAvatar(event.target.files?.[0])}
					/>
				</div>

				<div className="min-w-0 flex-1 space-y-3">
					<input
						value={draft.display_name}
						onChange={(e) => set({ display_name: e.target.value })}
						placeholder="Your name"
						aria-label="Your name"
						className="w-full border-0 bg-transparent p-0 text-2xl font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-0 sm:text-3xl"
					/>
					<input
						value={draft.headline}
						maxLength={120}
						onChange={(e) => set({ headline: e.target.value })}
						placeholder="One line on what you do"
						aria-label="Headline"
						className="w-full border-0 bg-transparent p-0 text-lg text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-0"
					/>
					<div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-muted-foreground">
						<MapPin className="h-4 w-4 shrink-0" />
						<input
							value={draft.city}
							onChange={(e) => set({ city: e.target.value })}
							placeholder="City"
							aria-label="City"
							className="min-w-10 border-0 bg-transparent p-0 text-sm text-muted-foreground outline-none field-sizing-content placeholder:text-muted-foreground/50 focus:ring-0"
						/>
						<span aria-hidden="true">,</span>
						<input
							value={draft.country}
							onChange={(e) => set({ country: e.target.value })}
							placeholder="Country"
							aria-label="Country"
							className="min-w-20 border-0 bg-transparent p-0 text-sm text-muted-foreground outline-none field-sizing-content placeholder:text-muted-foreground/50 focus:ring-0"
						/>
					</div>
					<p className="text-xs text-muted-foreground">
						Your headline and country are both needed before you can go live.
					</p>
				</div>
			</section>

			<section>
				<h3 className="mb-3 text-base font-semibold text-foreground">
					About me
				</h3>
				<textarea
					id="gl-bio"
					rows={7}
					value={draft.bio}
					maxLength={2000}
					onChange={(e) => set({ bio: e.target.value })}
					aria-label="About me"
					className="w-full resize-y border-0 border-b border-input bg-transparent px-0 py-2 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-0"
					placeholder="What you do, who you do it for, and what you are known for."
				/>
				<p className="mt-1 text-right text-xs text-muted-foreground">
					{draft.bio.length} / 2000
				</p>
			</section>

			<SkillsSection
				skills={draft.skills}
				onChange={(skills) => set({ skills })}
			/>

			{/* Specialization, presented under the name the profile uses. */}
			<section>
				<h3 className="text-base font-semibold text-foreground">Expertise</h3>
				<p className="mt-1 mb-4 text-sm text-muted-foreground">
					The kind of work you want to be matched with.
				</p>
				<div className="grid gap-4 sm:grid-cols-3">
					<GoLiveField label="Industry" htmlFor="gl-spec">
						<select
							id="gl-spec"
							value={draft.specCategory}
							onChange={(e) =>
								set({ specCategory: e.target.value as SpecializationCategory })
							}
							className="w-full cursor-pointer rounded-xl border border-input bg-card px-4 py-3 text-sm text-card-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25"
						>
							{SPECIALIZATIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</GoLiveField>
					{/*
					 * "Other" has no enum value to carry a real industry name, so the
					 * free-text column does it. That column is `sub_category`, which is
					 * the same one Focus writes to -- so this relabels the single field
					 * rather than adding a second one that would silently overwrite it.
					 */}
					<GoLiveField
						label={isOtherIndustry ? "Which industry?" : "Focus"}
						htmlFor="gl-subspec"
					>
						<input
							id="gl-subspec"
							value={draft.specSubcategory}
							onChange={(e) => set({ specSubcategory: e.target.value })}
							placeholder={
								isOtherIndustry
									? "e.g. Renewable energy"
									: "e.g. Platform engineering"
							}
							className="w-full border-0 border-b border-input bg-transparent px-0 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-0"
						/>
					</GoLiveField>
					<GoLiveField label="Years in it" htmlFor="gl-specyears">
						<input
							id="gl-specyears"
							type="number"
							min={0}
							value={draft.specYears}
							onChange={(e) => set({ specYears: e.target.value })}
							className="w-full border-0 border-b border-input bg-transparent px-0 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-0"
						/>
					</GoLiveField>
				</div>
			</section>

			<EntityList<ImportedExperience>
				title="Work experience"
				icon={Briefcase}
				optional
				description="Where you have worked and what you did there."
				items={draft.experiences}
				addLabel="Add work experience"
				emptyLabel="Nothing added yet."
				renderRow={(role) => (
					<>
						<p className="font-semibold text-foreground">{role.title}</p>
						<p className="text-sm text-muted-foreground">
							{role.company}
							{role.location ? ` \u00b7 ${role.location}` : ""}
						</p>
						<p className="text-sm text-muted-foreground">
							{monthYear(role.start_date)} -{" "}
							{role.is_current ? "Present" : monthYear(role.end_date)}
						</p>
						{role.description && (
							<p className="mt-2 line-clamp-3 text-sm leading-relaxed text-foreground/80">
								{role.description}
							</p>
						)}
					</>
				)}
				onAdd={() => setEditing({ kind: "experience", index: null })}
				onEdit={(index) => setEditing({ kind: "experience", index })}
				onRemove={(index) =>
					dispatch({ type: "removeFrom", key: "experiences", index })
				}
			/>

			<EntityList<ImportedEducation>
				title="Education"
				icon={GraduationCap}
				optional
				description="Degrees and programmes you have taken."
				items={draft.educations}
				addLabel="Add education"
				emptyLabel="Nothing added yet."
				renderRow={(entry) => (
					<>
						<p className="font-semibold text-foreground">{entry.institution}</p>
						<p className="text-sm text-muted-foreground">
							{[entry.degree, entry.field_of_study].filter(Boolean).join(", ")}
						</p>
						{(entry.start_year || entry.end_year) && (
							<p className="mt-0.5 text-xs text-muted-foreground">
								{entry.start_year} – {entry.end_year ?? "Present"}
							</p>
						)}
					</>
				)}
				onAdd={() => setEditing({ kind: "education", index: null })}
				onEdit={(index) => setEditing({ kind: "education", index })}
				onRemove={(index) =>
					dispatch({ type: "removeFrom", key: "educations", index })
				}
			/>

			<EntityList<ImportedCertification>
				title="Certifications"
				icon={Award}
				optional
				description="Credentials you have earned."
				items={draft.certifications}
				addLabel="Add certification"
				emptyLabel="Nothing added yet."
				renderRow={(cert) => (
					<>
						<p className="font-semibold text-foreground">{cert.name}</p>
						{cert.issuer && (
							<p className="text-sm text-muted-foreground">{cert.issuer}</p>
						)}
					</>
				)}
				onAdd={() => setEditing({ kind: "certification", index: null })}
				onEdit={(index) => setEditing({ kind: "certification", index })}
				onRemove={(index) =>
					dispatch({ type: "removeFrom", key: "certifications", index })
				}
			/>

			<ExperienceModal
				isOpen={editing?.kind === "experience"}
				onClose={() => setEditing(null)}
				initialData={
					editing?.kind === "experience" && editing.index !== null
						? (draft.experiences[editing.index] as never)
						: undefined
				}
				onSave={(payload) => {
					const value = payload as unknown as ImportedExperience;
					if (editing?.index != null) {
						dispatch({
							type: "replaceIn",
							key: "experiences",
							index: editing.index,
							value,
						});
					} else {
						dispatch({ type: "addTo", key: "experiences", value });
					}
					setEditing(null);
				}}
			/>

			<EducationModal
				isOpen={editing?.kind === "education"}
				onClose={() => setEditing(null)}
				initialData={
					editing?.kind === "education" && editing.index !== null
						? (draft.educations[editing.index] as never)
						: undefined
				}
				onSave={(payload) => {
					const value = payload as unknown as ImportedEducation;
					if (editing?.index != null) {
						dispatch({
							type: "replaceIn",
							key: "educations",
							index: editing.index,
							value,
						});
					} else {
						dispatch({ type: "addTo", key: "educations", value });
					}
					setEditing(null);
				}}
			/>

			<CertificationModal
				isOpen={editing?.kind === "certification"}
				onClose={() => setEditing(null)}
				initialData={
					editing?.kind === "certification" && editing.index !== null
						? (draft.certifications[editing.index] as never)
						: undefined
				}
				onSave={(payload) => {
					const value = payload as unknown as ImportedCertification;
					if (editing?.index != null) {
						dispatch({
							type: "replaceIn",
							key: "certifications",
							index: editing.index,
							value,
						});
					} else {
						dispatch({ type: "addTo", key: "certifications", value });
					}
					setEditing(null);
				}}
			/>
		</div>
	);
}
