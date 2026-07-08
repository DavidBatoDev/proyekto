-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.admin_profiles (
  user_id uuid NOT NULL,
  access_level USER-DEFINED NOT NULL DEFAULT 'support'::admin_access_level,
  department text,
  internal_notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT admin_profiles_pkey PRIMARY KEY (user_id),
  CONSTRAINT admin_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  channel_type USER-DEFINED NOT NULL,
  sender_id uuid NOT NULL,
  recipient_id uuid,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT chat_messages_pkey PRIMARY KEY (id),
  CONSTRAINT chat_messages_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT chat_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id),
  CONSTRAINT chat_messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.consultant_applications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  status USER-DEFINED NOT NULL DEFAULT 'draft'::application_status,
  cover_letter text,
  years_of_experience smallint,
  primary_niche text,
  linkedin_url text,
  website_url text,
  why_join text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  rejection_reason text,
  submitted_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT consultant_applications_pkey PRIMARY KEY (id),
  CONSTRAINT consultant_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT consultant_applications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.epic_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  epic_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT epic_comments_pkey PRIMARY KEY (id),
  CONSTRAINT epic_comments_epic_id_fkey FOREIGN KEY (epic_id) REFERENCES public.roadmap_epics(id),
  CONSTRAINT epic_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.feature_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  feature_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT feature_comments_pkey PRIMARY KEY (id),
  CONSTRAINT feature_comments_feature_id_fkey FOREIGN KEY (feature_id) REFERENCES public.roadmap_features(id),
  CONSTRAINT feature_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  name text NOT NULL,
  storage_path text NOT NULL,
  uploaded_by uuid NOT NULL,
  version integer DEFAULT 1,
  file_size bigint,
  mime_type text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT files_pkey PRIMARY KEY (id),
  CONSTRAINT files_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.languages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code character NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  CONSTRAINT languages_pkey PRIMARY KEY (id)
);
CREATE TABLE public.meetings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  type USER-DEFINED NOT NULL,
  scheduled_at timestamp with time zone NOT NULL,
  meeting_url text,
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT meetings_pkey PRIMARY KEY (id),
  CONSTRAINT meetings_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT meetings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.milestone_features (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL,
  feature_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT milestone_features_pkey PRIMARY KEY (id),
  CONSTRAINT milestone_features_milestone_id_fkey FOREIGN KEY (milestone_id) REFERENCES public.roadmap_milestones(id),
  CONSTRAINT milestone_features_feature_id_fkey FOREIGN KEY (feature_id) REFERENCES public.roadmap_features(id)
);
CREATE TABLE public.password_resets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  user_id uuid,
  code_hash text NOT NULL,
  salt text NOT NULL,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '00:10:00'::interval),
  consumed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT password_resets_pkey PRIMARY KEY (id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text UNIQUE,
  display_name text,
  avatar_url text,
  is_consultant_verified boolean DEFAULT false,
  active_persona USER-DEFINED DEFAULT 'freelancer'::persona_type,
  bio text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  gender text,
  phone_number text,
  country text,
  date_of_birth date,
  city text,
  zip_code text,
  is_email_verified boolean DEFAULT false,
  first_name text,
  last_name text,
  settings jsonb DEFAULT '{}'::jsonb CHECK (settings IS NULL OR settings::text = '{}'::text OR (settings -> 'onboarding'::text) IS NOT NULL AND ((settings -> 'onboarding'::text) ->> 'intent'::text) IS NOT NULL AND ((((settings -> 'onboarding'::text) -> 'intent'::text) ->> 'freelancer'::text) = ANY (ARRAY['true'::text, 'false'::text])) AND ((((settings -> 'onboarding'::text) -> 'intent'::text) ->> 'client'::text) = ANY (ARRAY['true'::text, 'false'::text])) AND ((settings -> 'onboarding'::text) ->> 'completed_at'::text) IS NOT NULL),
  has_completed_onboarding boolean DEFAULT false,
  tutorials_completed jsonb DEFAULT '{}'::jsonb,
  is_guest boolean DEFAULT false,
  guest_session_id text UNIQUE,
  migrated_from_guest_id uuid,
  headline text,
  banner_url text,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id),
  CONSTRAINT profiles_migrated_from_guest_id_fkey FOREIGN KEY (migrated_from_guest_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.project_briefs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  mission_vision text,
  scope_statement text,
  requirements jsonb DEFAULT '[]'::jsonb,
  constraints text,
  risk_register jsonb DEFAULT '[]'::jsonb,
  visibility_mask jsonb DEFAULT '{}'::jsonb,
  updated_by uuid,
  version integer DEFAULT 1,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT project_briefs_pkey PRIMARY KEY (id),
  CONSTRAINT project_briefs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT project_briefs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.project_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  permissions_json jsonb DEFAULT '{}'::jsonb,
  joined_at timestamp with time zone DEFAULT now(),
  CONSTRAINT project_members_pkey PRIMARY KEY (id),
  CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.projects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  status USER-DEFINED DEFAULT 'draft'::project_status,
  client_id uuid NOT NULL,
  consultant_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  platform_fee_percent numeric DEFAULT 10.00 CHECK (platform_fee_percent >= 0::numeric AND platform_fee_percent <= 100::numeric),
  consultant_fee_percent numeric DEFAULT 15.00 CHECK (consultant_fee_percent >= 0::numeric AND consultant_fee_percent <= 100::numeric),
  category text,
  project_state text,
  skills jsonb DEFAULT '[]'::jsonb,
  duration text,
  budget_range text,
  funding_status text,
  start_date text,
  custom_start_date timestamp with time zone,
  CONSTRAINT projects_pkey PRIMARY KEY (id),
  CONSTRAINT projects_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.profiles(id),
  CONSTRAINT projects_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.roadmap_epics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  priority USER-DEFINED DEFAULT 'medium'::epic_priority,
  status USER-DEFINED DEFAULT 'backlog'::epic_status,
  position integer NOT NULL,
  color text,
  estimated_hours numeric,
  actual_hours numeric,
  start_date timestamp with time zone,
  due_date timestamp with time zone,
  completed_date timestamp with time zone,
  tags ARRAY DEFAULT '{}'::text[],
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT roadmap_epics_pkey PRIMARY KEY (id),
  CONSTRAINT roadmap_epics_roadmap_id_fkey FOREIGN KEY (roadmap_id) REFERENCES public.roadmaps(id)
);
CREATE TABLE public.roadmap_features (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  epic_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  status USER-DEFINED DEFAULT 'not_started'::feature_status,
  position integer NOT NULL,
  estimated_hours numeric,
  actual_hours numeric,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  roadmap_id uuid NOT NULL,
  is_deliverable boolean NOT NULL DEFAULT true,
  CONSTRAINT roadmap_features_pkey PRIMARY KEY (id),
  CONSTRAINT roadmap_features_epic_id_fkey FOREIGN KEY (epic_id) REFERENCES public.roadmap_epics(id),
  CONSTRAINT fk_roadmap_features_roadmap FOREIGN KEY (roadmap_id) REFERENCES public.roadmaps(id)
);
CREATE TABLE public.roadmap_milestones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  target_date timestamp with time zone NOT NULL,
  completed_date timestamp with time zone,
  status USER-DEFINED DEFAULT 'not_started'::roadmap_milestone_status,
  position integer NOT NULL,
  color text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT roadmap_milestones_pkey PRIMARY KEY (id),
  CONSTRAINT roadmap_milestones_roadmap_id_fkey FOREIGN KEY (roadmap_id) REFERENCES public.roadmaps(id)
);
CREATE TABLE public.roadmap_shares (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL,
  share_token text NOT NULL DEFAULT encode(gen_random_bytes(16), 'base64'::text) UNIQUE,
  created_by uuid NOT NULL,
  invited_emails jsonb DEFAULT '[]'::jsonb,
  default_role USER-DEFINED NOT NULL DEFAULT 'viewer'::share_role CHECK (default_role = ANY (ARRAY['viewer'::share_role, 'commenter'::share_role])),
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT roadmap_shares_pkey PRIMARY KEY (id),
  CONSTRAINT roadmap_shares_roadmap_id_fkey FOREIGN KEY (roadmap_id) REFERENCES public.roadmaps(id),
  CONSTRAINT roadmap_shares_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.roadmap_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  feature_id uuid NOT NULL,
  title text NOT NULL,
  status USER-DEFINED DEFAULT 'todo'::task_status,
  priority USER-DEFINED DEFAULT 'medium'::task_priority,
  position integer NOT NULL,
  due_date timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT roadmap_tasks_pkey PRIMARY KEY (id),
  CONSTRAINT roadmap_tasks_feature_id_fkey FOREIGN KEY (feature_id) REFERENCES public.roadmap_features(id)
);
CREATE TABLE public.roadmaps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid,
  name text NOT NULL,
  description text,
  owner_id uuid NOT NULL,
  status USER-DEFINED DEFAULT 'draft'::roadmap_status,
  start_date timestamp with time zone,
  end_date timestamp with time zone,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  project_metadata jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT roadmaps_pkey PRIMARY KEY (id),
  CONSTRAINT roadmaps_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id),
  CONSTRAINT roadmaps_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.skills (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category text,
  created_at timestamp with time zone DEFAULT now(),
  slug text NOT NULL UNIQUE,
  is_user_generated boolean DEFAULT false,
  CONSTRAINT skills_pkey PRIMARY KEY (id)
);
CREATE TABLE public.task_attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  uploaded_by uuid NOT NULL,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size bigint,
  mime_type text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT task_attachments_pkey PRIMARY KEY (id),
  CONSTRAINT task_attachments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.roadmap_tasks(id),
  CONSTRAINT task_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.task_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  author_id uuid NOT NULL,
  content text NOT NULL,
  edited_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT task_comments_pkey PRIMARY KEY (id),
  CONSTRAINT task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.roadmap_tasks(id),
  CONSTRAINT task_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_certifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  issuer text NOT NULL,
  issue_date date,
  expiry_date date,
  credential_id text,
  credential_url text,
  is_verified boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_certifications_pkey PRIMARY KEY (id),
  CONSTRAINT user_certifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_educations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  institution text NOT NULL,
  degree text,
  field_of_study text,
  start_year smallint,
  end_year smallint,
  is_current boolean DEFAULT false,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_educations_pkey PRIMARY KEY (id),
  CONSTRAINT user_educations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_experiences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company text NOT NULL,
  title text NOT NULL,
  location text,
  is_remote boolean DEFAULT false,
  description text,
  start_date date NOT NULL,
  end_date date,
  is_current boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_experiences_pkey PRIMARY KEY (id),
  CONSTRAINT user_experiences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_identity_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type USER-DEFINED NOT NULL DEFAULT 'other'::identity_document_type,
  storage_path text NOT NULL,
  is_verified boolean DEFAULT false,
  expires_at date,
  uploaded_at timestamp with time zone DEFAULT now(),
  verified_at timestamp with time zone,
  verified_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_identity_documents_pkey PRIMARY KEY (id),
  CONSTRAINT user_identity_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT user_identity_documents_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_languages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  language_id uuid NOT NULL,
  fluency_level USER-DEFINED NOT NULL DEFAULT 'conversational'::fluency_level,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_languages_pkey PRIMARY KEY (id),
  CONSTRAINT user_languages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT user_languages_language_id_fkey FOREIGN KEY (language_id) REFERENCES public.languages(id)
);
CREATE TABLE public.user_licenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  type USER-DEFINED DEFAULT 'other'::license_type,
  issuing_authority text NOT NULL,
  license_number text,
  issue_date date,
  expiry_date date,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_licenses_pkey PRIMARY KEY (id),
  CONSTRAINT user_licenses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_portfolios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  url text,
  image_url text,
  tags ARRAY DEFAULT '{}'::text[],
  position smallint DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_portfolios_pkey PRIMARY KEY (id),
  CONSTRAINT user_portfolios_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_rate_settings (
  user_id uuid NOT NULL,
  hourly_rate numeric,
  currency character DEFAULT 'USD'::bpchar,
  min_project_budget numeric,
  availability USER-DEFINED DEFAULT 'available'::availability_status,
  weekly_hours smallint,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_rate_settings_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_rate_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_skills (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  skill_id uuid NOT NULL,
  proficiency_level USER-DEFINED NOT NULL DEFAULT 'intermediate'::proficiency_level,
  years_experience smallint,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_skills_pkey PRIMARY KEY (id),
  CONSTRAINT user_skills_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT user_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id)
);
CREATE TABLE public.user_specializations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category USER-DEFINED NOT NULL,
  sub_category text,
  years_of_experience smallint,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_specializations_pkey PRIMARY KEY (id),
  CONSTRAINT user_specializations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_stats (
  user_id uuid NOT NULL,
  total_earnings numeric DEFAULT 0,
  avg_rating numeric DEFAULT 0,
  total_reviews integer DEFAULT 0,
  jobs_completed integer DEFAULT 0,
  jobs_in_progress integer DEFAULT 0,
  response_rate numeric DEFAULT 0,
  on_time_rate numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_stats_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_verifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type USER-DEFINED NOT NULL,
  status USER-DEFINED NOT NULL DEFAULT 'pending'::verification_status,
  verified_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_verifications_pkey PRIMARY KEY (id),
  CONSTRAINT user_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.wallets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  available_balance numeric NOT NULL DEFAULT 0.00 CHECK (available_balance >= 0::numeric),
  escrow_balance numeric NOT NULL DEFAULT 0.00 CHECK (escrow_balance >= 0::numeric),
  currency text NOT NULL DEFAULT 'USD'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT wallets_pkey PRIMARY KEY (id),
  CONSTRAINT wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);