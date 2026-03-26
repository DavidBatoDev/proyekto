export type TimeLogStatus = 'pending' | 'approved' | 'rejected';
export type TimeLogSource = 'timer' | 'manual';
export type ProjectTaskOption = {
  id: string;
  title: string;
  feature_title?: string;
  epic_title?: string;
  feature_position?: number;
  epic_position?: number;
};

export type ProjectMemberTimeRateRecord = {
  id: string;
  project_id: string;
  project_member_id: string;
  member_user_id: string;
  hourly_rate: number;
  currency: string;
  custom_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at: string;
  updated_at: string;
  member?: {
    id: string;
    display_name?: string;
    email?: string;
    avatar_url?: string;
    banner_url?: string;
  };
  project_member?: {
    id: string;
    role?: string;
    position?: string;
  };
};

export type TaskTimeLogRecord = {
  id: string;
  project_id: string;
  task_id: string;
  member_user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  status: TimeLogStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  source: TimeLogSource;
  created_at: string;
  updated_at: string;
  task?: {
    id: string;
    title: string;
  };
  member?: {
    id: string;
    display_name?: string;
    email?: string;
    avatar_url?: string;
  };
  reviewer?: {
    id: string;
    display_name?: string;
    email?: string;
    avatar_url?: string;
  };
};

export type TimeLogsListResult = {
  items: TaskTimeLogRecord[];
  total: number;
  page: number;
  limit: number;
};

export type TimeLogsQueryFilters = {
  from?: string;
  to?: string;
  status?: TimeLogStatus;
  member_user_id?: string;
  task_id?: string;
  page: number;
  limit: number;
};

export interface ProjectTimeRepository {
  hasProjectMemberRate(
    projectId: string,
    memberUserId: string,
  ): Promise<boolean>;
  findProjectMemberRateById(
    projectId: string,
    rateId: string,
  ): Promise<ProjectMemberTimeRateRecord | null>;
  findProjectMemberRateByUser(
    projectId: string,
    memberUserId: string,
  ): Promise<ProjectMemberTimeRateRecord | null>;
  listProjectTasks(projectId: string): Promise<ProjectTaskOption[]>;
  listProjectMemberRates(
    projectId: string,
  ): Promise<ProjectMemberTimeRateRecord[]>;
  createProjectMemberRate(params: {
    project_id: string;
    project_member_id: string;
    member_user_id: string;
    hourly_rate: number;
    currency: string;
    custom_id?: string | null;
    start_date: string;
    end_date?: string | null;
  }): Promise<ProjectMemberTimeRateRecord>;
  updateProjectMemberRateById(
    id: string,
    patch: {
      hourly_rate?: number;
      currency?: string;
      custom_id?: string | null;
      start_date?: string;
      end_date?: string | null;
    },
  ): Promise<ProjectMemberTimeRateRecord>;
  deleteProjectMemberRateById(id: string): Promise<void>;
  getProjectMemberForUser(
    projectId: string,
    userId: string,
  ): Promise<{ id: string; user_id: string | null } | null>;
  getProjectMemberById(
    projectId: string,
    projectMemberId: string,
  ): Promise<{ id: string; user_id: string | null } | null>;
  getTaskProjectId(taskId: string): Promise<string | null>;
  findById(id: string): Promise<TaskTimeLogRecord | null>;
  findByIds(ids: string[]): Promise<TaskTimeLogRecord[]>;
  stopActiveForMember(
    projectId: string,
    memberUserId: string,
    endedAtIso: string,
  ): Promise<void>;
  createStartedLog(params: {
    project_id: string;
    task_id: string;
    member_user_id: string;
    started_at: string;
    source: TimeLogSource;
  }): Promise<TaskTimeLogRecord>;
  stopLogById(params: {
    id: string;
    ended_at: string;
  }): Promise<TaskTimeLogRecord>;
  deleteLogById(id: string): Promise<void>;
  updateLogById(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<TaskTimeLogRecord>;
  updateLogReviewByIds(
    ids: string[],
    patch: {
      status: TimeLogStatus;
      reviewed_by: string | null;
      reviewed_at: string | null;
      review_note: string | null;
    },
  ): Promise<TaskTimeLogRecord[]>;
  listProjectLogs(
    projectId: string,
    filters: TimeLogsQueryFilters,
  ): Promise<TimeLogsListResult>;
  listTaskLogsForMember(params: {
    projectId: string;
    taskId: string;
    memberUserId: string;
    page: number;
    limit: number;
  }): Promise<TimeLogsListResult>;
}
