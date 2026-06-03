// Core entity types matching the Supabase database schema

export type PersonaType = 'client' | 'freelancer' | 'consultant' | 'admin';
export type ProjectStatus =
  | 'draft'
  | 'bidding'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived';
export type PaymentStatus =
  | 'pending'
  | 'completed'
  | 'funded'
  | 'in_escrow'
  | 'released'
  | 'refunded'
  | 'disputed';
export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'escrow_lock'
  | 'escrow_release'
  | 'escrow_refund'
  | 'platform_fee'
  | 'consultant_fee'
  | 'freelancer_payout';
export type RoadmapStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived';
export type RoadmapMilestoneStatus =
  | 'not_started'
  | 'in_progress'
  | 'at_risk'
  | 'completed'
  | 'missed';
export type EpicStatus =
  | 'backlog'
  | 'planned'
  | 'in_progress'
  | 'in_review'
  | 'completed'
  | 'on_hold';
export type EpicPriority =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'nice_to_have';
export type FeatureStatus =
  | 'not_started'
  | 'in_progress'
  | 'in_review'
  | 'completed'
  | 'blocked';
export type TaskStatus =
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'blocked';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';
export type ShareRole = 'viewer' | 'commenter' | 'editor';
export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected';
export type AdminAccessLevel = 'support' | 'moderator' | 'super_admin';
export type AvailabilityStatus =
  | 'available'
  | 'partially_available'
  | 'unavailable';
export type ProficiencyLevel =
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'expert';
export type FluencyLevel = 'basic' | 'conversational' | 'fluent' | 'native';
export type LicenseType =
  | 'legal'
  | 'engineering'
  | 'medical'
  | 'financial'
  | 'real_estate'
  | 'other';
export type SpecializationCategory =
  | 'fintech'
  | 'healthcare'
  | 'e_commerce'
  | 'saas'
  | 'education'
  | 'real_estate'
  | 'legal'
  | 'marketing'
  | 'logistics'
  | 'media'
  | 'gaming'
  | 'ai_ml'
  | 'cybersecurity'
  | 'blockchain'
  | 'other';

export interface Profile {
  id: string;
  email?: string;
  display_name?: string;
  avatar_url?: string;
  banner_url?: string;
  first_name?: string;
  last_name?: string;
  bio?: string;
  headline?: string;
  gender?: string;
  phone_number?: string;
  country?: string;
  city?: string;
  zip_code?: string;
  date_of_birth?: string;
  is_consultant_verified: boolean;
  is_email_verified: boolean;
  is_phone_verified?: boolean;
  active_persona: PersonaType;
  has_completed_onboarding: boolean;
  settings: Record<string, unknown>;
  is_guest: boolean;
  guest_session_id?: string;
  migrated_from_guest_id?: string;
  tutorials_completed?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AdminProfile {
  user_id: string;
  access_level: AdminAccessLevel;
  department?: string;
  internal_notes?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  title: string;
  description?: string;
  status: ProjectStatus;
  client_id: string;
  consultant_id?: string;
  platform_fee_percent: number;
  consultant_fee_percent: number;
  category?: string;
  project_state?: string;
  skills?: unknown[];
  duration?: string;
  budget_range?: string;
  funding_status?: string;
  start_date?: string;
  custom_start_date?: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: 'consultant' | 'client' | 'member';
  position?: string;
  permissions_json: Record<string, unknown>;
  joined_at: string;
}

export interface ProjectResourceFolder {
  id: string;
  project_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectResourceLink {
  id: string;
  project_id: string;
  folder_id?: string | null;
  title: string;
  url: string;
  description?: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PaymentCheckpoint {
  id: string;
  project_id: string;
  milestone_id?: string;
  amount: number;
  status: PaymentStatus;
  payer_id: string;
  payee_id: string;
  description?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  available_balance: number;
  escrow_balance: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  wallet_id: string;
  project_id?: string;
  checkpoint_id?: string;
  amount: number;
  type: TransactionType;
  description?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Roadmap {
  id: string;
  project_id?: string;
  name: string;
  description?: string;
  category?: string;
  owner_id: string;
  status: RoadmapStatus;
  start_date?: string;
  end_date?: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RoadmapMilestone {
  id: string;
  roadmap_id: string;
  title: string;
  description?: string;
  target_date: string;
  completed_date?: string;
  status: RoadmapMilestoneStatus;
  position: number;
  color?: string;
  created_at: string;
  updated_at: string;
}

export interface Epic {
  id: string;
  roadmap_id: string;
  title: string;
  description?: string;
  priority: EpicPriority;
  status: EpicStatus;
  position: number;
  color?: string;
  estimated_hours?: number;
  actual_hours?: number;
  start_date?: string;
  due_date?: string;
  completed_date?: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Feature {
  id: string;
  roadmap_id: string;
  epic_id: string;
  title: string;
  description?: string;
  status: FeatureStatus;
  position: number;
  is_deliverable: boolean;
  estimated_hours?: number;
  actual_hours?: number;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  feature_id: string;
  title: string;
  description?: string;
  assignee_id?: string;
  reporter_id?: string;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  estimated_hours?: number;
  actual_hours?: number;
  due_date?: string;
  completed_at?: string;
  labels: string[];
  checklist: unknown[];
  created_at: string;
  updated_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  content: string;
  edited_at?: string;
  created_at: string;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploaded_by: string;
  file_name: string;
  file_url: string;
  file_size?: number;
  mime_type?: string;
  created_at: string;
}

export interface RoadmapShare {
  id: string;
  roadmap_id: string;
  share_token: string;
  created_by: string;
  invited_emails: { email: string; role: ShareRole }[];
  default_role: ShareRole;
  is_active: boolean;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ConsultantApplication {
  id: string;
  user_id: string;
  status: ApplicationStatus;
  cover_letter?: string;
  years_of_experience?: number;
  primary_niche?: string;
  linkedin_url?: string;
  website_url?: string;
  why_join?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  rejection_reason?: string;
  submitted_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Skill {
  id: string;
  name: string;
  category?: string;
  slug?: string;
  is_user_generated?: boolean;
  created_at: string;
}

export interface Language {
  id: string;
  code: string;
  name: string;
}

export interface UserSkill {
  id: string;
  user_id: string;
  skill_id: string;
  proficiency_level: ProficiencyLevel;
  years_experience?: number;
  created_at: string;
  skill?: Skill;
}

export interface UserLanguage {
  id: string;
  user_id: string;
  language_id: string;
  fluency_level: FluencyLevel;
  created_at: string;
  language?: Language;
}

export interface UserEducation {
  id: string;
  user_id: string;
  institution: string;
  degree?: string;
  field_of_study?: string;
  start_year?: number;
  end_year?: number;
  is_current: boolean;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface UserCertification {
  id: string;
  user_id: string;
  name: string;
  issuer?: string;
  issue_date?: string;
  expiry_date?: string;
  credential_id?: string;
  credential_url?: string;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserLicense {
  id: string;
  user_id: string;
  name: string;
  type: LicenseType;
  issuing_authority?: string;
  license_number?: string;
  issue_date?: string;
  expiry_date?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserExperience {
  id: string;
  user_id: string;
  company: string;
  title: string;
  location?: string;
  is_remote: boolean;
  description?: string;
  start_date: string;
  end_date?: string;
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserPortfolio {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  url?: string;
  image_url?: string;
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
  created_at: string;
  updated_at: string;
}

export interface UserSpecialization {
  id: string;
  user_id: string;
  category: SpecializationCategory;
  sub_category?: string;
  years_of_experience?: number;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface UserRateSettings {
  user_id: string;
  hourly_rate?: number;
  currency: string;
  min_project_budget?: number;
  availability: AvailabilityStatus;
  weekly_hours?: number;
  created_at: string;
  updated_at: string;
}

export interface UserIdentityDocument {
  id: string;
  user_id: string;
  type: string;
  storage_path: string;
  is_verified: boolean;
  expires_at?: string;
  uploaded_at?: string;
  verified_at?: string;
  verified_by?: string;
  created_at: string;
  updated_at: string;
}
