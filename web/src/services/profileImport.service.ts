/**
 * Profile import — read a LinkedIn PDF or CV into a draft, then apply it.
 *
 * Two calls on purpose. `parse` writes nothing; the user reviews and edits the
 * draft in step 2, and `apply` takes the edited version. Re-parsing at save
 * time would silently discard their corrections.
 */

import apiClient, { API_BASE_URL } from "@/api/axios";
import { getAccessToken } from "@/lib/supabase";
import type {
	FluencyLevel,
	ProficiencyLevel,
	SpecializationCategory,
} from "@/services/profile.service";

export interface ImportedBasics {
	display_name?: string;
	headline?: string;
	bio?: string;
	country?: string;
	city?: string;
}

export interface ImportedSkill {
	name: string;
	proficiency_level?: ProficiencyLevel;
	years_experience?: number;
}

export interface ImportedLanguage {
	name: string;
	fluency_level?: FluencyLevel;
}

export interface ImportedExperience {
	company: string;
	title: string;
	location?: string;
	is_remote?: boolean;
	description?: string;
	/** ISO date. LinkedIn gives month + year only, so the day is synthesised. */
	start_date: string;
	end_date?: string;
	is_current?: boolean;
}

export interface ImportedEducation {
	institution: string;
	degree?: string;
	field_of_study?: string;
	start_year?: number;
	end_year?: number;
	is_current?: boolean;
	description?: string;
}

export interface ImportedCertification {
	name: string;
	/** Often absent — LinkedIn exports do not carry an issuer at all. */
	issuer?: string;
	issue_date?: string;
	expiry_date?: string;
	credential_id?: string;
	credential_url?: string;
}

export interface ImportedSpecialization {
	category?: SpecializationCategory;
	sub_category?: string;
	years_of_experience?: number;
}

export interface ImportedProfile {
	source?: "linkedin_pdf" | "cv_llm" | "manual";
	basics?: ImportedBasics;
	skills?: ImportedSkill[];
	languages?: ImportedLanguage[];
	experiences?: ImportedExperience[];
	educations?: ImportedEducation[];
	certifications?: ImportedCertification[];
	specialization?: ImportedSpecialization;
	links?: string[];
	/** What could not be read. Shown to the user rather than swallowed. */
	warnings?: string[];
}

export interface ImportCounts {
	skills_created: number;
	skills_linked: number;
	languages: number;
	experiences: number;
	educations: number;
	certifications: number;
}

class ProfileImportService {
	private base = "/api/profile/import";

	/**
	 * Reads a PDF into a draft. Writes nothing, and the file is never stored.
	 *
	 * Uses native fetch rather than apiClient: axios sets a JSON content-type by
	 * default, which stops the browser writing the multipart boundary and makes
	 * multer report "no file". The upload service documents the same trap.
	 */
	async parse(file: File): Promise<ImportedProfile> {
		const token = await getAccessToken();
		const body = new FormData();
		body.append("file", file);

		const response = await fetch(`${API_BASE_URL}${this.base}/parse`, {
			method: "POST",
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			body,
		});

		if (!response.ok) {
			const detail = (await response.json().catch(() => null)) as {
				message?: string;
			} | null;
			throw new Error(
				detail?.message ?? "We could not read that file. Please try another.",
			);
		}

		const payload = (await response.json()) as
			| { data?: ImportedProfile }
			| ImportedProfile;
		// Every backend response is wrapped by ResponseInterceptor, but `??` on a
		// truthy `{ data: null }` envelope would hand back the envelope itself.
		if (payload && typeof payload === "object" && "data" in payload) {
			return (payload as { data: ImportedProfile }).data ?? {};
		}
		return (payload as ImportedProfile) ?? {};
	}

	/** Applies the reviewed draft. One request, one transaction. */
	async apply(draft: ImportedProfile): Promise<ImportCounts> {
		const { data } = await apiClient.post(`${this.base}/apply`, draft);
		return data.data as ImportCounts;
	}
}

export const profileImportService = new ProfileImportService();
