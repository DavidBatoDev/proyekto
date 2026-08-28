import {
	type DraftAction,
	draftReducer,
	emptyDraft,
	type ProfileDraft,
} from "@/components/marketplace/wizard/profileDraft";
import type { ConsultantApplication } from "@/services/profile.service";

export interface DraftPlacement {
	subcategoryId: string;
	/** Bucket floor in years (0, 1, 3, 5, 10); null until the applicant answers. */
	yearsExperience: number | null;
}

/**
 * The consultant application wizard's state.
 *
 * It extends the shared ProfileDraft rather than composing beside it: steps 1
 * and 2 are literally the talent wizard's components, and they dispatch
 * ProfileDraft actions against this same object. The extension carries only
 * what the application adds — taxonomy picks with per-speciality years and
 * the LinkedIn URL. Identity documents are not draft state: uploads persist
 * to the profile the moment they happen, exactly like the profile
 * sub-entities in step 2's modals.
 */
export interface ConsultantApplyDraft extends ProfileDraft {
	/** Speciality picks with years, in display order. */
	placements: DraftPlacement[];
	primarySubcategoryId: string | null;
	linkedinUrl: string;
}

export const emptyApplyDraft: ConsultantApplyDraft = {
	...emptyDraft,
	placements: [],
	primarySubcategoryId: null,
	linkedinUrl: "",
};

export type ApplyAction =
	| DraftAction
	| {
			type: "setApply";
			patch: Partial<
				Pick<
					ConsultantApplyDraft,
					"placements" | "primarySubcategoryId" | "linkedinUrl"
				>
			>;
	  }
	| { type: "hydrateApplication"; application: ConsultantApplication };

export function applyReducer(
	state: ConsultantApplyDraft,
	action: ApplyAction,
): ConsultantApplyDraft {
	switch (action.type) {
		case "setApply":
			return { ...state, ...action.patch };

		case "hydrateApplication": {
			const placements = [...(action.application.placements ?? [])].sort(
				(a, b) => a.position - b.position,
			);
			return {
				...state,
				placements: placements.map((p) => ({
					subcategoryId: p.subcategory_id,
					yearsExperience: p.years_experience ?? null,
				})),
				primarySubcategoryId:
					placements.find((p) => p.is_primary)?.subcategory_id ?? null,
				linkedinUrl: action.application.linkedin_url ?? "",
			};
		}

		default:
			// Profile actions flow through the shared reducer. Its cases spread
			// `state`, so the apply-only fields survive every profile update.
			return draftReducer(state, action) as ConsultantApplyDraft;
	}
}
