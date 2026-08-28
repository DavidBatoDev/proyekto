import type {
	AvailabilityStatus,
	FullProfile,
	SpecializationCategory,
	UserPortfolio,
} from "@/services/profile.service";
import type {
	ImportedCertification,
	ImportedEducation,
	ImportedExperience,
	ImportedLanguage,
	ImportedProfile,
	ImportedSkill,
} from "@/services/profileImport.service";

/**
 * The wizard's entire state, in one object.
 *
 * The previous version held twelve separate `useState` calls, which was fine
 * when a step was three fields. Step 2 now carries basics, skills, languages,
 * specialization, experience, education and certifications — several of them
 * arrays that get spliced — so a single reducer keeps the update rules in one
 * readable place instead of scattered across the route.
 *
 * An import populates this draft, NOT the database. Nothing is written until
 * the user has seen it, which is what makes "review your profile" honest and
 * stops an abandoned import from leaving debris on a real profile.
 */

export type ImportPath = "manual" | "import";

export interface ProfileDraft {
	/** Which path the user chose on step 1. */
	path: ImportPath | null;
	/** Where step 2's contents came from — drives the "please check this" banner. */
	source: "linkedin_pdf" | "cv_llm" | "manual";
	warnings: string[];

	display_name: string;
	headline: string;
	bio: string;
	country: string;
	city: string;
	/**
	 * Either a stored CDN url or a local `blob:` preview. A picked image is NOT
	 * uploaded on selection -- it shows instantly and is sent when the step is
	 * saved, so abandoning the wizard never leaves an orphaned object in R2.
	 */
	avatar_url: string | null;
	/** Set only while an image is waiting to be uploaded. */
	avatarFile: File | null;

	skills: ImportedSkill[];
	languages: ImportedLanguage[];
	experiences: ImportedExperience[];
	educations: ImportedEducation[];
	certifications: ImportedCertification[];

	specCategory: SpecializationCategory;
	specSubcategory: string;
	specYears: string;

	/** Portfolio links added in step 3, before they become user_portfolios rows. */
	links: string[];

	availability: AvailabilityStatus;
	hourlyRate: string;
	currency: string;
	weeklyHours: string;
}

export const emptyDraft: ProfileDraft = {
	path: null,
	source: "manual",
	warnings: [],
	display_name: "",
	headline: "",
	bio: "",
	country: "",
	city: "",
	avatar_url: null,
	avatarFile: null,
	skills: [],
	languages: [],
	experiences: [],
	educations: [],
	certifications: [],
	specCategory: "other",
	specSubcategory: "",
	specYears: "",
	links: [],
	availability: "available",
	hourlyRate: "0",
	currency: "USD",
	weeklyHours: "10",
};

export type DraftAction =
	| { type: "set"; patch: Partial<ProfileDraft> }
	| { type: "hydrate"; profile: FullProfile; portfolios: UserPortfolio[] }
	| { type: "applyImport"; imported: ImportedProfile }
	| { type: "addTo"; key: ListKey; value: ListItem }
	| { type: "replaceIn"; key: ListKey; index: number; value: ListItem }
	| { type: "removeFrom"; key: ListKey; index: number };

type ListKey =
	| "skills"
	| "languages"
	| "experiences"
	| "educations"
	| "certifications";
type ListItem =
	| ImportedSkill
	| ImportedLanguage
	| ImportedExperience
	| ImportedEducation
	| ImportedCertification;

export function draftReducer(
	state: ProfileDraft,
	action: DraftAction,
): ProfileDraft {
	switch (action.type) {
		case "set":
			return { ...state, ...action.patch };

		case "hydrate": {
			// Everything already on the profile wins over the blank defaults, so
			// somebody re-running the wizard sees their own data rather than an
			// empty form that would overwrite it.
			const { profile, portfolios } = action;
			const spec = profile.specializations?.[0];
			const rate = profile.rate_settings;
			return {
				...state,
				display_name: profile.display_name ?? "",
				headline: profile.headline ?? "",
				bio: profile.bio ?? "",
				country: profile.country ?? "",
				city: profile.city ?? "",
				avatar_url: profile.avatar_url ?? null,
				skills: (profile.skills ?? []).map((s) => ({
					name: s.skill.name,
					proficiency_level: s.proficiency_level,
					years_experience: s.years_experience ?? undefined,
				})),
				languages: (profile.languages ?? []).map((l) => ({
					name: l.language.name,
					fluency_level: l.fluency_level,
				})),
				experiences: (profile.experiences ?? []).map((e) => ({
					company: e.company,
					title: e.title,
					location: e.location ?? undefined,
					description: e.description ?? undefined,
					start_date: e.start_date,
					end_date: e.end_date ?? undefined,
					is_current: e.is_current,
				})),
				educations: (profile.educations ?? []).map((e) => ({
					institution: e.institution,
					degree: e.degree ?? undefined,
					field_of_study: e.field_of_study ?? undefined,
					start_year: e.start_year ?? undefined,
					end_year: e.end_year ?? undefined,
				})),
				certifications: (profile.certifications ?? []).map((c) => ({
					name: c.name,
					issuer: c.issuer ?? undefined,
					credential_url: c.credential_url ?? undefined,
				})),
				specCategory: spec?.category ?? "other",
				specSubcategory: spec?.sub_category ?? "",
				specYears:
					spec?.years_of_experience != null
						? String(spec.years_of_experience)
						: "",
				links: portfolios.map((p) => p.url).filter((u): u is string => !!u),
				availability: rate?.availability ?? "available",
				hourlyRate: rate?.hourly_rate != null ? String(rate.hourly_rate) : "0",
				currency: rate?.currency ?? "USD",
				weeklyHours:
					rate?.weekly_hours != null ? String(rate.weekly_hours) : "10",
			};
		}

		case "applyImport": {
			const { imported } = action;
			const basics = imported.basics ?? {};
			// An imported value only fills a gap; it never clears something the
			// person already has on their profile.
			const prefer = (incoming: string | undefined, current: string) =>
				incoming?.trim() ? incoming : current;

			return {
				...state,
				source: imported.source === "cv_llm" ? "cv_llm" : "linkedin_pdf",
				warnings: imported.warnings ?? [],
				display_name: prefer(basics.display_name, state.display_name),
				headline: prefer(basics.headline, state.headline),
				bio: prefer(basics.bio, state.bio),
				country: prefer(basics.country, state.country),
				city: prefer(basics.city, state.city),
				skills: mergeByKey(state.skills, imported.skills ?? [], (s) =>
					s.name.toLowerCase(),
				),
				languages: mergeByKey(state.languages, imported.languages ?? [], (l) =>
					l.name.toLowerCase(),
				),
				experiences: mergeByKey(
					state.experiences,
					imported.experiences ?? [],
					(e) =>
						`${e.company.toLowerCase()}|${e.title.toLowerCase()}|${e.start_date}`,
				),
				educations: mergeByKey(
					state.educations,
					imported.educations ?? [],
					(e) =>
						`${e.institution.toLowerCase()}|${(e.degree ?? "").toLowerCase()}`,
				),
				certifications: mergeByKey(
					state.certifications,
					imported.certifications ?? [],
					(c) => `${c.name.toLowerCase()}|${(c.issuer ?? "").toLowerCase()}`,
				),
				links: [...new Set([...state.links, ...(imported.links ?? [])])],
			};
		}

		case "addTo":
			return {
				...state,
				[action.key]: [...state[action.key], action.value],
			} as ProfileDraft;

		case "replaceIn":
			return {
				...state,
				[action.key]: state[action.key].map((item, i) =>
					i === action.index ? action.value : item,
				),
			} as ProfileDraft;

		case "removeFrom":
			return {
				...state,
				[action.key]: state[action.key].filter((_, i) => i !== action.index),
			} as ProfileDraft;

		default:
			return state;
	}
}

/** Appends only what is genuinely new, so re-importing does not duplicate. */
function mergeByKey<T>(
	existing: T[],
	incoming: T[],
	key: (item: T) => string,
): T[] {
	const seen = new Set(existing.map(key));
	const merged = [...existing];
	for (const item of incoming) {
		const id = key(item);
		if (seen.has(id)) continue;
		seen.add(id);
		merged.push(item);
	}
	return merged;
}

/**
 * What still blocks go-live, computed from the draft.
 *
 * Mirrors TalentEligibilityService so step 2 and step 3 can warn early;
 * step 5 still asks the server, because identity verification is a review the
 * client cannot see the outcome of.
 */
export function draftGaps(draft: ProfileDraft): string[] {
	const gaps: string[] = [];
	if (!draft.headline.trim()) gaps.push("a headline");
	if (!draft.bio.trim()) gaps.push("a short bio");
	if (!draft.country.trim()) gaps.push("your country");
	if (!draft.links.length) gaps.push("at least one piece of work");
	if (!Number.parseFloat(draft.hourlyRate)) gaps.push("an hourly rate");
	return gaps;
}
