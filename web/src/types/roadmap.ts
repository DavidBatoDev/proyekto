// Roadmap Canvas Types
// Matching the database schema from ROADMAP_CANVAS_SCHEMA.md

export type RoadmapStatus =
  | "draft"
  | "active"
  | "paused"
  | "completed"
  | "archived";
export type MilestoneStatus =
  | "not_started"
  | "in_progress"
  | "at_risk"
  | "completed"
  | "missed";
export type EpicStatus =
  | "backlog"
  | "planned"
  | "in_progress"
  | "in_review"
  | "completed"
  | "on_hold";
export type EpicPriority =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "nice_to_have";
export type FeatureStatus =
  | "not_started"
  | "in_progress"
  | "in_review"
  | "completed"
  | "blocked";
export type TaskStatus =
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked";
export type TaskPriority = "urgent" | "high" | "medium" | "low";
export type TaskWorkType = "real_work" | "training";

export interface Roadmap {
  id: string;
  project_id: string | null; // Nullable for guest users without projects
  name: string;
  description?: string;
  category?: string;
  owner_id: string;
  status: RoadmapStatus;
  start_date?: string;
  end_date?: string;
  settings?: Record<string, any>;
  preview_url?: string; // Optional image URL for roadmap thumbnail preview
  created_at: string;
  updated_at: string;
  // Sharing
  currentUserRole?: ShareRole | "owner"; // Current user's access level
  // Related data (populated by getFull())
  epics?: RoadmapEpic[];
  milestones?: RoadmapMilestone[];
  owner?: {
    id: string;
    display_name?: string;
    avatar_url?: string;
    headline?: string;
  };
}

export interface RoadmapMilestone {
  id: string;
  roadmap_id: string;
  title: string;
  description?: string;
  target_date: string;
  completed_date?: string;
  status: MilestoneStatus;
  position: number;
  color?: string;
  created_at: string;
  updated_at: string;
  // Computed fields
  progress?: number;
  linked_features?: RoadmapFeature[]; // v2.0: Milestones now link to features, not epics
}

export interface RoadmapEpic {
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
  end_date?: string;
  completed_date?: string;
  tags?: string[]; // Legacy: kept for backward compatibility
  labels?: Array<{ id: string; name: string; color: string }>; // New: label objects with colors
  created_at: string;
  updated_at: string;
  // Computed fields
  progress?: number;
  features?: RoadmapFeature[];
  comments?: Comment[]; // Comments on this epic
}

export interface MilestoneFeatureLink {
  id: string;
  milestone_id: string;
  feature_id: string; // v2.0: Changed from epic_id to feature_id
  position: number;
  created_at: string;
}

export interface RoadmapFeature {
  id: string;
  roadmap_id: string; // v2.0: Denormalized for performance
  epic_id: string;
  title: string;
  description?: string;
  position: number;
  is_deliverable: boolean; // v2.0: Whether this feature counts toward milestone progress
  estimated_hours?: number;
  actual_hours?: number;
  start_date?: string;
  end_date?: string;
  created_at: string;
  updated_at: string;
  // The explicit "feature team". Write via assignee_ids; read via assignees.
  assignee_ids?: string[];
  assignees?: AssigneeProfile[];
  // Computed fields
  progress?: number;
  comments?: Comment[]; // Comments on this feature
  tasks?: RoadmapTask[];
}

export interface ChecklistItem {
  id?: string;
  title: string;
  completed: boolean;
}

// A person who can be assigned to a task or feature. Shape mirrors the profile
// columns embedded by the backend (`assignee:profiles(...)`).
export interface AssigneeProfile {
  id: string;
  display_name?: string;
  avatar_url?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
}

export interface RoadmapTask {
  id: string;
  feature_id: string;
  title: string;
  // Legacy single-assignee FK, kept as the "primary" assignee (= assignees[0]).
  assignee_id?: string | null;
  // Full multi-assignee set. Write via assignee_ids; read via assignees.
  assignee_ids?: string[];
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  due_date?: string;
  completed_at?: string;
  work_type?: TaskWorkType;
  created_at: string;
  updated_at: string;
  // Additional optional fields
  description?: string | null;
  checklist?: ChecklistItem[];
  // Primary assignee profile (legacy single-assignee reads).
  assignee?: AssigneeProfile;
  // Full assignee profiles from the join table.
  assignees?: AssigneeProfile[];
  labels?: string[];
}

export interface TaskActivityEntry {
  id: string;
  task_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  changed_by_user?: { id: string; display_name?: string; avatar_url?: string };
}

export interface TaskDependency {
  id: string;
  blocking_task_id: string;
  blocked_task_id: string;
  created_at: string;
  blocking_task?: { id: string; title: string; status: TaskStatus };
  blocked_task?: { id: string; title: string; status: TaskStatus };
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  content: string;
  edited_at?: string;
  created_at: string;
  // Populated fields
  author?: {
    id: string;
    display_name?: string;
    avatar_url?: string;
  };
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploaded_by: string;
  file_name: string;
  file_url: string | null;
  file_size?: number;
  mime_type?: string;
  created_at: string;
}

// View modes for the roadmap canvas
export type RoadmapViewMode = "milestone" | "roadmap";

// Sharing Types
export type ShareRole = "viewer" | "commenter" | "editor";

export interface InvitedUser {
  email: string;
  role: ShareRole;
}

export interface RoadmapShare {
  id: string;
  roadmap_id: string;
  share_token: string;
  created_by: string;
  invited_emails: InvitedUser[];
  default_role: ShareRole;
  is_active: boolean;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  user_id: string;
  author_id?: string;
  content: string;
  edited_at?: string;
  created_at: string;
  updated_at: string;
  // Populated fields
  user?: {
    id: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
    email?: string;
  };
}

// UI State
export interface RoadmapCanvasState {
  viewMode: RoadmapViewMode;
  selectedMilestoneId?: string;
  selectedEpicId?: string;
  selectedFeatureId?: string;
  selectedTaskId?: string;
  sidePanelOpen: boolean;
  sidePanelContent?: "details" | "comments" | "attachments";
}
