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
CREATE TABLE public.chat_room_message_reactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  room_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  emoji text NOT NULL CHECK (char_length(btrim(emoji)) > 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chat_room_message_reactions_pkey PRIMARY KEY (id),
  CONSTRAINT chat_room_message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_room_messages(id),
  CONSTRAINT chat_room_message_reactions_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id),
  CONSTRAINT chat_room_message_reactions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT chat_room_message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.chat_room_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  project_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  content text NOT NULL CHECK (char_length(btrim(content)) > 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chat_room_messages_pkey PRIMARY KEY (id),
  CONSTRAINT chat_room_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id),
  CONSTRAINT chat_room_messages_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT chat_room_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.chat_room_participants (
  room_id uuid NOT NULL,
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  last_read_at timestamp with time zone,
  CONSTRAINT chat_room_participants_pkey PRIMARY KEY (room_id, user_id),
  CONSTRAINT chat_room_participants_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id),
  CONSTRAINT chat_room_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT chat_room_participants_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.chat_rooms (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  type USER-DEFINED NOT NULL,
  slug text NOT NULL CHECK (char_length(btrim(slug)) > 0),
  name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chat_rooms_pkey PRIMARY KEY (id),
  CONSTRAINT chat_rooms_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
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
CREATE TABLE public.notification_types (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category USER-DEFINED NOT NULL,
  priority USER-DEFINED NOT NULL DEFAULT 'medium'::notification_priority,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT notification_types_pkey PRIMARY KEY (id)
);
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid,
  type_id uuid NOT NULL,
  actor_id uuid,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamp with time zone,
  link_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT notifications_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT notifications_type_id_fkey FOREIGN KEY (type_id) REFERENCES public.notification_types(id),
  CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id)
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
  settings jsonb DEFAULT '{}'::jsonb CHECK (settings IS NULL OR settings::text = '{}'::text OR (settings -> 'onboarding'::text) IS NOT NULL AND ((settings -> 'onboarding'::text) ->> 'intent'::text) IS NOT NULL AND ((((settings -> 'onboarding'::text) -> 'intent'::text) ->> 'freelancer'::text) = ANY (ARRAY['true'::text, 'false'::text])) AND ((((settings -> 'onboarding'::text) -> 'intent'::text) ->> 'client'::text) = ANY (ARRAY['true'::text, 'false'::text])) AND ((settings -> 'onboarding'::text) ->> 'completed_at'::text) IS NOT NULL AND (((settings -> 'onboarding'::text) ->> 'lane'::text) = ANY (ARRAY['client_freelancer'::text, 'consultant'::text]))),
  has_completed_onboarding boolean DEFAULT false,
  tutorials_completed jsonb DEFAULT '{}'::jsonb,
  is_guest boolean DEFAULT false,
  guest_session_id text UNIQUE,
  migrated_from_guest_id uuid,
  headline text,
  banner_url text,
  is_public boolean NOT NULL DEFAULT false,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id),
  CONSTRAINT profiles_migrated_from_guest_id_fkey FOREIGN KEY (migrated_from_guest_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.project_access (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role USER-DEFINED NOT NULL,
  origin text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  granted_by uuid,
  granted_at timestamp with time zone NOT NULL DEFAULT now(),
  position text,
  has_direct_grant boolean NOT NULL DEFAULT false,
  CONSTRAINT project_access_pkey PRIMARY KEY (id),
  CONSTRAINT project_access_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT project_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT project_access_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.project_briefs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  updated_by uuid,
  version integer DEFAULT 1,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  project_summary text,
  custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(custom_fields) = 'array'::text),
  CONSTRAINT project_briefs_pkey PRIMARY KEY (id),
  CONSTRAINT project_briefs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT project_briefs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.project_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  invited_by uuid NOT NULL,
  invitee_id uuid,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text])),
  message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  invitee_email text,
  invited_position text,
  responded_at timestamp with time zone,
  default_role USER-DEFINED,
  CONSTRAINT project_invites_pkey PRIMARY KEY (id),
  CONSTRAINT project_invites_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT project_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id),
  CONSTRAINT project_invites_invitee_id_fkey FOREIGN KEY (invitee_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.project_resource_folders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) > 0),
  position integer NOT NULL DEFAULT 0 CHECK ("position" >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT project_resource_folders_pkey PRIMARY KEY (id),
  CONSTRAINT project_resource_folders_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.project_resource_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  folder_id uuid,
  title text NOT NULL CHECK (char_length(btrim(title)) > 0),
  url text NOT NULL CHECK (char_length(url) <= 2048),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  position integer NOT NULL DEFAULT 0 CHECK ("position" >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT project_resource_links_pkey PRIMARY KEY (id),
  CONSTRAINT project_resource_links_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT project_resource_links_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.project_resource_folders(id)
);
CREATE TABLE public.project_team_members (
  project_id uuid NOT NULL,
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  added_by uuid,
  added_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT project_team_members_pkey PRIMARY KEY (project_id, team_id, user_id),
  CONSTRAINT project_team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT project_team_members_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id),
  CONSTRAINT project_team_members_project_id_team_id_fkey FOREIGN KEY (project_id) REFERENCES public.project_teams(project_id),
  CONSTRAINT project_team_members_project_id_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.project_teams(project_id),
  CONSTRAINT project_team_members_project_id_team_id_fkey FOREIGN KEY (project_id) REFERENCES public.project_teams(team_id),
  CONSTRAINT project_team_members_project_id_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.project_teams(team_id),
  CONSTRAINT project_team_members_team_id_user_id_fkey FOREIGN KEY (team_id) REFERENCES public.team_members(team_id),
  CONSTRAINT project_team_members_team_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.team_members(team_id),
  CONSTRAINT project_team_members_team_id_user_id_fkey FOREIGN KEY (team_id) REFERENCES public.team_members(user_id),
  CONSTRAINT project_team_members_team_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.team_members(user_id)
);
CREATE TABLE public.project_teams (
  project_id uuid NOT NULL,
  team_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  attached_by uuid,
  attached_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT project_teams_pkey PRIMARY KEY (project_id, team_id),
  CONSTRAINT project_teams_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT project_teams_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT project_teams_attached_by_fkey FOREIGN KEY (attached_by) REFERENCES public.profiles(id)
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
  banner_url text,
  role_permissions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_personal_workspace boolean NOT NULL DEFAULT false,
  primary_team_id uuid,
  CONSTRAINT projects_pkey PRIMARY KEY (id),
  CONSTRAINT projects_primary_team_id_fkey FOREIGN KEY (primary_team_id) REFERENCES public.teams(id),
  CONSTRAINT projects_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.profiles(id),
  CONSTRAINT projects_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.roadmap_ai_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  seq bigint NOT NULL,
  role text NOT NULL CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])),
  content text NOT NULL,
  intent_type text,
  response_mode text,
  parse_mode text,
  artifacts jsonb,
  activity_timeline jsonb,
  commit_lifecycle jsonb,
  tokens integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT roadmap_ai_messages_pkey PRIMARY KEY (id),
  CONSTRAINT roadmap_ai_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.roadmap_ai_sessions(id)
);
CREATE TABLE public.roadmap_ai_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL,
  user_id uuid NOT NULL,
  title text,
  mode text NOT NULL DEFAULT 'chat'::text CHECK (mode = ANY (ARRAY['chat'::text, 'edit_plan'::text])),
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamp with time zone,
  is_pinned boolean NOT NULL DEFAULT false,
  pinned_at timestamp with time zone,
  last_message_at timestamp with time zone,
  message_count integer NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT roadmap_ai_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT roadmap_ai_sessions_roadmap_id_fkey FOREIGN KEY (roadmap_id) REFERENCES public.roadmaps(id),
  CONSTRAINT roadmap_ai_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
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
  end_date timestamp with time zone,
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
  start_date timestamp with time zone,
  end_date timestamp with time zone,
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
  assignee_id uuid,
  CONSTRAINT roadmap_tasks_pkey PRIMARY KEY (id),
  CONSTRAINT roadmap_tasks_feature_id_fkey FOREIGN KEY (feature_id) REFERENCES public.roadmap_features(id),
  CONSTRAINT roadmap_tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.profiles(id)
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
  preview_url text,
  is_public boolean NOT NULL DEFAULT false,
  is_templatable boolean NOT NULL DEFAULT false,
  category text,
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
CREATE TABLE public.task_time_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  task_id uuid,
  member_user_id uuid NOT NULL,
  started_at timestamp with time zone NOT NULL,
  ended_at timestamp with time zone,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  review_note text,
  source text NOT NULL DEFAULT 'timer'::text CHECK (source = ANY (ARRAY['timer'::text, 'manual'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  rate_snapshot numeric NOT NULL DEFAULT 0 CHECK (rate_snapshot >= 0::numeric),
  currency_snapshot text NOT NULL DEFAULT 'USD'::text,
  team_id uuid,
  CONSTRAINT task_time_logs_pkey PRIMARY KEY (id),
  CONSTRAINT task_time_logs_member_user_id_fkey FOREIGN KEY (member_user_id) REFERENCES public.profiles(id),
  CONSTRAINT task_time_logs_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id),
  CONSTRAINT task_time_logs_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT task_time_logs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT task_time_logs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.roadmap_tasks(id)
);
CREATE TABLE public.team_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  invited_by uuid,
  invitee_id uuid,
  invitee_email text,
  role text NOT NULL DEFAULT 'member'::text CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])),
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text])),
  message text,
  responded_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  position text,
  CONSTRAINT team_invites_pkey PRIMARY KEY (id),
  CONSTRAINT team_invites_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT team_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id),
  CONSTRAINT team_invites_invitee_id_fkey FOREIGN KEY (invitee_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.team_member_rates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  hourly_rate numeric NOT NULL CHECK (hourly_rate >= 0::numeric),
  currency text NOT NULL DEFAULT 'USD'::text,
  custom_id text,
  start_date date,
  end_date date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT team_member_rates_pkey PRIMARY KEY (id),
  CONSTRAINT team_member_rates_team_user_fk FOREIGN KEY (team_id) REFERENCES public.team_members(team_id),
  CONSTRAINT team_member_rates_team_user_fk FOREIGN KEY (user_id) REFERENCES public.team_members(team_id),
  CONSTRAINT team_member_rates_team_user_fk FOREIGN KEY (team_id) REFERENCES public.team_members(user_id),
  CONSTRAINT team_member_rates_team_user_fk FOREIGN KEY (user_id) REFERENCES public.team_members(user_id)
);
CREATE TABLE public.team_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member'::text CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])),
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  position text,
  CONSTRAINT team_members_pkey PRIMARY KEY (id),
  CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.teams (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  avatar_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  is_personal boolean NOT NULL DEFAULT false,
  time_tracking_enabled boolean NOT NULL DEFAULT false,
  CONSTRAINT teams_pkey PRIMARY KEY (id),
  CONSTRAINT teams_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id)
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
