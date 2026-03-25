/**
 * Admin Service
 * API calls for the admin dashboard — applications, admin management, matchmaking
 */

import apiClient from "@/api/axios";
import type { UserSkill, UserLanguage, UserEducation, UserCertification, UserLicense, UserExperience, UserPortfolio, UserSpecialization, UserIdentityDocument, UserRateSettings } from "./profile.service";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ApplicationStatus = "draft" | "submitted" | "under_review" | "approved" | "rejected";
export type AdminAccessLevel = "support" | "moderator" | "super_admin";

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
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  submitted_at?: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  applicant?: {
    id: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    email: string;
    avatar_url?: string;
    headline?: string;
    is_consultant_verified: boolean;
  };
}

export interface ApplicationDetail extends ConsultantApplication {
  vetting: {
    skills: UserSkill[];
    languages: UserLanguage[];
    educations: UserEducation[];
    certifications: UserCertification[];
    licenses: UserLicense[];
    experiences: UserExperience[];
    specializations: UserSpecialization[];
    identity_documents: UserIdentityDocument[];
    rate_settings: UserRateSettings | null;
    portfolios: UserPortfolio[];
  };
}

export interface AdminProfile {
  id: string;
  user_id: string;
  access_level: AdminAccessLevel;
  department?: string | null;
  internal_notes?: string | null;
  is_active: boolean;
  created_at: string;
  user?: {
    id: string;
    display_name?: string;
    email: string;
    avatar_url?: string;
  };
}

export interface MatchCandidate {
  id: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  email: string;
  avatar_url?: string;
  headline?: string;
  bio?: string;
  match_score: number;
  rate_settings?: UserRateSettings | null;
  stats?: {
    avg_rating: number;
    jobs_completed: number;
    on_time_rate: number;
  } | null;
  specializations?: UserSpecialization[];
  skills?: UserSkill[];
}

export interface ConsultantProfile {
  id: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  email: string;
  avatar_url?: string | null;
  banner_url?: string | null;
  headline?: string | null;
  bio?: string | null;
  phone_number?: string | null;
  country?: string | null;
  city?: string | null;
  is_consultant_verified: boolean;
  skills: UserSkill[];
  languages: UserLanguage[];
  educations: UserEducation[];
  certifications: UserCertification[];
  licenses: UserLicense[];
  experiences: UserExperience[];
  specializations: UserSpecialization[];
  portfolios: UserPortfolio[];
  rate_settings: UserRateSettings | null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class AdminService {
  private base = "/api/admin";

  // Check if current user is an admin
  async getMe(): Promise<AdminProfile | null> {
    const { data } = await apiClient.get(`${this.base}/me`);
    return data.data;
  }

  // —— Applications —————————————————————————————————————

  async getApplications(status?: ApplicationStatus): Promise<ConsultantApplication[]> {
    const params = status ? `?status=${status}` : "";
    const { data } = await apiClient.get(`${this.base}/applications${params}`);
    return data.data ?? [];
  }

  async getApplication(id: string): Promise<ApplicationDetail> {
    const { data } = await apiClient.get(`${this.base}/applications/${id}`);
    return data.data;
  }

  async approveApplication(id: string): Promise<void> {
    await apiClient.post(`${this.base}/applications/${id}/approve`);
  }

  async rejectApplication(id: string, reason?: string): Promise<void> {
    await apiClient.post(`${this.base}/applications/${id}/reject`, { reason });
  }

  // —— Admin Management ————————————————————————————————

  async getAdmins(): Promise<AdminProfile[]> {
    const { data } = await apiClient.get(`${this.base}/admins`);
    return data.data ?? [];
  }

  async grantAdmin(userId: string, payload: { access_level?: AdminAccessLevel; department?: string }): Promise<AdminProfile> {
    const { data } = await apiClient.post(`${this.base}/admins/${userId}/grant`, payload);
    return data.data;
  }

  async revokeAdmin(userId: string): Promise<void> {
    await apiClient.delete(`${this.base}/admins/${userId}/revoke`);
  }

  // —— Matchmaking ——————————————————————————————————————

  async getMatchCandidates(projectId?: string): Promise<MatchCandidate[]> {
    const params = projectId ? `?projectId=${projectId}` : "";
    const { data } = await apiClient.get(`${this.base}/match-candidates${params}`);
    return data.data ?? [];
  }

  async getConsultantProfile(consultantId: string): Promise<ConsultantProfile> {
    const { data } = await apiClient.get(`${this.base}/consultants/${consultantId}/profile`);
    return data.data;
  }

  async searchConsultants(params: {
    q?: string;
    niche?: string;
    availability?: string;
    minRate?: number;
    maxRate?: number;
  } = {}): Promise<MatchCandidate[]> {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.niche) qs.set("niche", params.niche);
    if (params.availability) qs.set("availability", params.availability);
    if (params.minRate != null) qs.set("minRate", String(params.minRate));
    if (params.maxRate != null) qs.set("maxRate", String(params.maxRate));
    const suffix = qs.toString() ? `?${qs}` : "";
    const { data } = await apiClient.get(`${this.base}/match-candidates${suffix}`);
    return data.data ?? [];
  }

  async assignConsultant(projectId: string, consultantId: string): Promise<void> {
    await apiClient.post(`${this.base}/match-assign`, { project_id: projectId, consultant_id: consultantId });
  }

  // —— Users ————————————————————————————————————————————

  async getAllUsers(): Promise<any[]> {
    const { data } = await apiClient.get(`${this.base}/users`);
    return data.data ?? [];
  }

  async getAllProjects(): Promise<any[]> {
    const { data } = await apiClient.get(`${this.base}/projects`);
    return data.data ?? [];
  }
}

export const adminService = new AdminService();
