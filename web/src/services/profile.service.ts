/**
 * Profile Service
 * All Identity & Vetting API calls — uses the shared apiClient (not Supabase direct)
 */

import apiClient from "@/api/axios";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProficiencyLevel =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "expert";
export type FluencyLevel = "basic" | "conversational" | "fluent" | "native";
export type AvailabilityStatus =
  | "available"
  | "partially_available"
  | "unavailable";
export type SpecializationCategory =
  | "fintech"
  | "healthcare"
  | "e_commerce"
  | "saas"
  | "education"
  | "real_estate"
  | "legal"
  | "marketing"
  | "logistics"
  | "media"
  | "gaming"
  | "ai_ml"
  | "cybersecurity"
  | "blockchain"
  | "other";

export interface SkillMeta {
  id: string;
  name: string;
  category?: string;
  slug?: string;
}
export interface LanguageMeta {
  id: string;
  name: string;
  code: string;
}

export interface UserSkill {
  id: string;
  proficiency_level: ProficiencyLevel;
  years_experience?: number | null;
  skill: SkillMeta;
}

export interface UserLanguage {
  id: string;
  language_id: string;
  fluency_level: FluencyLevel;
  language: LanguageMeta;
}

export interface UserEducation {
  id: string;
  user_id: string;
  institution: string;
  degree?: string | null;
  field_of_study?: string | null;
  start_year?: number | null;
  end_year?: number | null;
  is_current: boolean;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCertification {
  id: string;
  user_id: string;
  name: string;
  issuer: string;
  issue_date?: string | null;
  expiry_date?: string | null;
  credential_id?: string | null;
  credential_url?: string | null;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserExperience {
  id: string;
  user_id: string;
  company: string;
  title: string;
  location?: string | null;
  is_remote: boolean;
  description?: string | null;
  start_date: string;
  end_date?: string | null;
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserPortfolio {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  url?: string | null;
  image_url?: string | null;
  tags: string[];
  position: number;
  created_at: string;
  updated_at: string;
}

export interface UserStats {
  user_id: string;
  total_earnings: number;
  avg_rating: number;
  total_reviews: number;
  jobs_completed: number;
  jobs_in_progress: number;
  response_rate: number;
  on_time_rate: number;
}

export interface UserSpecialization {
  id: string;
  user_id: string;
  category: SpecializationCategory;
  sub_category?: string | null;
  years_of_experience?: number | null;
  description?: string | null;
}

export interface UpdateSpecializationPayload {
  category?: SpecializationCategory;
  sub_category?: string;
  years_of_experience?: number;
  description?: string;
}

export interface UserRateSettings {
  user_id: string;
  hourly_rate?: number | null;
  currency: string;
  min_project_budget?: number | null;
  availability: AvailabilityStatus;
  weekly_hours?: number | null;
}

export type LicenseType =
  | "legal"
  | "engineering"
  | "medical"
  | "financial"
  | "real_estate"
  | "other";

export interface UserLicense {
  id: string;
  user_id: string;
  name: string;
  type: LicenseType;
  issuing_authority: string;
  license_number?: string | null;
  issue_date?: string | null;
  expiry_date?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type IdentityDocumentType =
  | "passport"
  | "national_id"
  | "drivers_license"
  | "other";

export interface UserIdentityDocument {
  id: string;
  user_id: string;
  type: IdentityDocumentType;
  storage_path: string;
  is_verified: boolean;
  expires_at?: string | null;
  uploaded_at: string;
  verified_at?: string | null;
  verified_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FullProfile {
  id: string;
  email: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  bio: string | null;
  headline: string | null;
  phone_number: string | null;
  country: string | null;
  city: string | null;
  zip_code: string | null;
  gender: string | null;
  date_of_birth: string | null;
  is_consultant_verified: boolean;
  is_phone_verified: boolean;
  is_public: boolean;
  active_persona: string;
  created_at: string;
  updated_at: string;
  // vetting tables
  skills: UserSkill[];
  languages: UserLanguage[];
  educations: UserEducation[];
  certifications: UserCertification[];
  licenses: UserLicense[];
  experiences: UserExperience[];
  portfolios: UserPortfolio[];
  stats: UserStats | null;
  specializations: UserSpecialization[];
  rate_settings: UserRateSettings | null;
  identity_documents: UserIdentityDocument[];
}

export interface UpdateProfileData {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  bio?: string | null;
  headline?: string | null;
  phone_number?: string | null;
  country?: string | null;
  city?: string | null;
  zip_code?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  avatar_url?: string | null;
  is_public?: boolean;
}

export interface MarketplaceFreelancerCard {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  headline: string | null;
  is_email_verified: boolean;
  avg_rating: number;
  availability: AvailabilityStatus;
  hourly_rate: number | null;
  currency: string;
  specialization: string | null;
  skills: Array<{ id: string; name: string; slug: string }>;
}

export interface MarketplaceFreelancersQuery {
  search?: string;
  skill?: string;
  availability?: AvailabilityStatus;
  specialization?: string;
  sort?: "rating_desc" | "rate_asc" | "rate_desc";
}

export interface MarketplaceInviteItem {
  id: string;
  project_id: string;
  invited_by: string;
  invitee_id: string;
  status: "pending" | "accepted" | "declined";
  message: string | null;
  created_at: string;
  updated_at: string;
  project: {
    id: string;
    title: string;
    status: string;
  } | null;
  inviter: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class ProfileService {
  private base = "/api/profile";
  private marketplaceBase = "/api/marketplace";

  /** Fetch full profile (all vetting tables) by user ID */
  async getProfile(userId: string): Promise<FullProfile> {
    const { data } = await apiClient.get(`${this.base}/${userId}`);
    return data.data;
  }

  /** Update core profile fields */
  async updateProfile(updates: UpdateProfileData): Promise<FullProfile> {
    const { data } = await apiClient.patch(this.base, updates);
    return data.data;
  }

  /** Request phone OTP — sends verification code via SMS */
  async requestPhoneVerification(): Promise<{ success: boolean; debug_code?: string }> {
    const { data } = await apiClient.post(`${this.base}/phone-verification/request`);
    return data;
  }

  /** Confirm phone OTP — marks phone as verified */
  async confirmPhoneVerification(code: string): Promise<{ success: boolean }> {
    const { data } = await apiClient.post(`${this.base}/phone-verification/confirm`, { code });
    return data;
  }

  /** Replace all skills (full replace, not merge) */
  async updateSkills(
    skills: Array<{
      skill_id: string;
      proficiency_level: ProficiencyLevel;
      years_experience?: number;
    }>,
  ): Promise<UserSkill[]> {
    const { data } = await apiClient.put(`${this.base}/skills`, { skills });
    return data.data;
  }

  /** Replace all languages */
  async updateLanguages(
    languages: Array<{ language_id: string; fluency_level: FluencyLevel }>,
  ): Promise<UserLanguage[]> {
    const { data } = await apiClient.put(`${this.base}/languages`, {
      languages,
    });
    return data.data;
  }

  // ── Educations ──────────────────────────────────────────────────────────────
  async addEducation(
    payload: Omit<
      UserEducation,
      "id" | "user_id" | "created_at" | "updated_at"
    >,
  ): Promise<UserEducation> {
    const { data } = await apiClient.post(`${this.base}/educations`, payload);
    return data.data;
  }
  async updateEducation(
    id: string,
    payload: Partial<UserEducation>,
  ): Promise<UserEducation> {
    const { data } = await apiClient.patch(
      `${this.base}/educations/${id}`,
      payload,
    );
    return data.data;
  }
  async deleteEducation(id: string): Promise<void> {
    await apiClient.delete(`${this.base}/educations/${id}`);
  }

  // ── Certifications ─────────────────────────────────────────────────────────
  async addCertification(
    payload: Omit<
      UserCertification,
      "id" | "user_id" | "is_verified" | "created_at" | "updated_at"
    >,
  ): Promise<UserCertification> {
    const { data } = await apiClient.post(
      `${this.base}/certifications`,
      payload,
    );
    return data.data;
  }
  async updateCertification(
    id: string,
    payload: Partial<UserCertification>,
  ): Promise<UserCertification> {
    const { data } = await apiClient.patch(
      `${this.base}/certifications/${id}`,
      payload,
    );
    return data.data;
  }
  async deleteCertification(id: string): Promise<void> {
    await apiClient.delete(`${this.base}/certifications/${id}`);
  }

  // ── Experiences ────────────────────────────────────────────────────────────
  async addExperience(
    payload: Omit<
      UserExperience,
      "id" | "user_id" | "created_at" | "updated_at"
    >,
  ): Promise<UserExperience> {
    const { data } = await apiClient.post(`${this.base}/experiences`, payload);
    return data.data;
  }
  async updateExperience(
    id: string,
    payload: Partial<UserExperience>,
  ): Promise<UserExperience> {
    const { data } = await apiClient.patch(
      `${this.base}/experiences/${id}`,
      payload,
    );
    return data.data;
  }
  async deleteExperience(id: string): Promise<void> {
    await apiClient.delete(`${this.base}/experiences/${id}`);
  }

  // ── Portfolios ─────────────────────────────────────────────────────────────
  async addPortfolio(
    payload: Omit<
      UserPortfolio,
      "id" | "user_id" | "created_at" | "updated_at"
    >,
  ): Promise<UserPortfolio> {
    const { data } = await apiClient.post(`${this.base}/portfolios`, payload);
    return data.data;
  }
  async updatePortfolio(
    id: string,
    payload: Partial<UserPortfolio>,
  ): Promise<UserPortfolio> {
    const { data } = await apiClient.patch(
      `${this.base}/portfolios/${id}`,
      payload,
    );
    return data.data;
  }
  async deletePortfolio(id: string): Promise<void> {
    await apiClient.delete(`${this.base}/portfolios/${id}`);
  }

  // ── Rate Settings ──────────────────────────────────────────────────────────
  async updateRateSettings(
    payload: Partial<UserRateSettings>,
  ): Promise<UserRateSettings> {
    const { data } = await apiClient.put(`${this.base}/rate-settings`, payload);
    return data.data;
  }

  // ── Languages (Individual endpoints) ───────────────────────────────────────
  async addLanguage(
    payload: Omit<UserLanguage, "id" | "user_id" | "created_at">,
  ): Promise<UserLanguage> {
    const { data } = await apiClient.post(`${this.base}/languages`, {
      language_id: payload.language_id,
      fluency_level: payload.fluency_level,
    });
    return data.data;
  }
  async updateLanguage(
    id: string,
    payload: Partial<UserLanguage>,
  ): Promise<UserLanguage> {
    const { data } = await apiClient.patch(
      `${this.base}/languages/${id}`,
      payload,
    );
    return data.data;
  }
  async deleteLanguage(id: string): Promise<void> {
    await apiClient.delete(`${this.base}/languages/${id}`);
  }

  // ── Specializations ────────────────────────────────────────────────────────
  async addSpecialization(
    payload: Omit<
      UserSpecialization,
      "id" | "user_id" | "created_at" | "updated_at"
    >,
  ): Promise<UserSpecialization> {
    const { data } = await apiClient.post(
      `${this.base}/specializations`,
      payload,
    );
    return data.data;
  }
  async updateSpecialization(
    id: string,
    payload: UpdateSpecializationPayload,
  ): Promise<UserSpecialization> {
    const { data } = await apiClient.patch(
      `${this.base}/specializations/${id}`,
      payload,
    );
    return data.data;
  }
  async deleteSpecialization(id: string): Promise<void> {
    await apiClient.delete(`${this.base}/specializations/${id}`);
  }

  // ── Licenses ───────────────────────────────────────────────────────────────
  async addLicense(
    payload: Omit<UserLicense, "id" | "user_id" | "created_at" | "updated_at">,
  ): Promise<UserLicense> {
    const { data } = await apiClient.post(`${this.base}/licenses`, payload);
    return data.data;
  }
  async updateLicense(
    id: string,
    payload: Partial<UserLicense>,
  ): Promise<UserLicense> {
    const { data } = await apiClient.patch(
      `${this.base}/licenses/${id}`,
      payload,
    );
    return data.data;
  }
  async deleteLicense(id: string): Promise<void> {
    await apiClient.delete(`${this.base}/licenses/${id}`);
  }

  // ── Identity Documents ─────────────────────────────────────────────────────
  async addIdentityDocument(
    payload: Omit<
      UserIdentityDocument,
      | "id"
      | "user_id"
      | "is_verified"
      | "verified_at"
      | "verified_by"
      | "uploaded_at"
      | "created_at"
      | "updated_at"
    >,
  ): Promise<UserIdentityDocument> {
    const { data } = await apiClient.post(
      `${this.base}/identity_documents`,
      payload,
    );
    return data.data;
  }
  async deleteIdentityDocument(id: string): Promise<void> {
    await apiClient.delete(`${this.base}/identity_documents/${id}`);
  }

  // ── Meta ───────────────────────────────────────────────────────────────────
  async getAllSkills(): Promise<SkillMeta[]> {
    const { data } = await apiClient.get(`${this.base}/meta/skills`);
    return data.data;
  }
  async getAllLanguages(): Promise<LanguageMeta[]> {
    const { data } = await apiClient.get(`${this.base}/meta/languages`);
    return data.data;
  }

  async goLive(): Promise<{ is_public: boolean }> {
    const { data } = await apiClient.post(`${this.marketplaceBase}/go-live`);
    return data.data;
  }

  async getMarketplaceFreelancers(
    filters: MarketplaceFreelancersQuery = {},
  ): Promise<MarketplaceFreelancerCard[]> {
    const { data } = await apiClient.get(
      `${this.marketplaceBase}/freelancers`,
      {
        params: filters,
      },
    );
    return data.data;
  }

  async inviteFreelancer(payload: {
    projectId: string;
    inviteeId: string;
    message?: string;
  }): Promise<{ id: string; status: string }> {
    const { data } = await apiClient.post(
      `${this.marketplaceBase}/invite`,
      payload,
    );
    return data.data;
  }

  async getMyInvites(): Promise<MarketplaceInviteItem[]> {
    const { data } = await apiClient.get(`${this.marketplaceBase}/invites/me`);
    return data.data;
  }

  async respondToInvite(payload: {
    inviteId: string;
    status: "accepted" | "declined";
  }): Promise<{ id: string; status: string }> {
    const { data } = await apiClient.patch(
      `${this.marketplaceBase}/invites/${payload.inviteId}/respond`,
      { status: payload.status },
    );
    return data.data;
  }
}

export const profileService = new ProfileService();

// ─── Consultant Application ───────────────────────────────────────────────────
export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected";

export interface ConsultantApplication {
  id: string;
  user_id: string;
  status: ApplicationStatus;
  cover_letter?: string | null;
  years_of_experience?: number | null;
  primary_niche?: string | null;
  linkedin_url?: string | null;
  website_url?: string | null;
  why_join?: string | null;
  rejection_reason?: string | null;
  submitted_at?: string | null;
  created_at: string;
  updated_at: string;
}

class ApplicationService {
  private base = "/api/applications";

  async getMyApplication(): Promise<ConsultantApplication | null> {
    const { data } = await apiClient.get(`${this.base}/me`);
    return data.data;
  }

  async saveDraft(
    payload: Partial<
      Omit<
        ConsultantApplication,
        "id" | "user_id" | "status" | "created_at" | "updated_at"
      >
    >,
  ): Promise<ConsultantApplication> {
    const { data } = await apiClient.post(this.base, payload);
    return data.data;
  }

  async submit(): Promise<ConsultantApplication> {
    const { data } = await apiClient.post(`${this.base}/submit`);
    return data.data;
  }
}

export const applicationService = new ApplicationService();
