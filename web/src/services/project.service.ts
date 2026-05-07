import { supabase } from "@/lib/supabase";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

export interface CreateProjectData {
  creation_mode?: "client" | "consultant";
  title: string;
  brief?: string;
  description?: string;
  category?: string;
  project_state?: string;
  skills?: string[];
  duration?: string;
  budget_range?: string;
  funding_status?: string;
  start_date?: string;
  custom_start_date?: string;
  status?: "draft" | "active" | "bidding" | "paused" | "completed" | "archived";
  /**
   * Consultant-mode only: optional team picked at create-time. The
   * backend attaches it as the primary team after the project is
   * created. Omit (or set undefined) for "no team — attach later".
   */
  primary_team_id?: string;
}

export interface Project {
  id: string;
  title: string;
  brief?: string;
  description?: string;
  category?: string;
  project_state?: string;
  skills?: string[];
  duration?: string;
  budget_range?: string;
  funding_status?: string;
  start_date?: string;
  custom_start_date?: string;
  status: "draft" | "active" | "bidding" | "paused" | "completed" | "archived";
  banner_url?: string;
  client_id: string;
  consultant_id?: string;
  client?: {
    id: string;
    display_name?: string;
    avatar_url?: string;
    email?: string;
  };
  consultant?: {
    id: string;
    display_name?: string;
    avatar_url?: string;
    email?: string;
  };
  members?: ProjectMember[];
  created_at: string;
  updated_at: string;
}

export type PermissionDependencyMissing = {
  path: string;
  requires: string[];
};

export class PermissionDependencyError extends Error {
  code: string | null;
  missing: PermissionDependencyMissing[] | null;
  constructor(
    message: string,
    options: {
      code: string | null;
      missing: PermissionDependencyMissing[] | null;
    },
  ) {
    super(message);
    this.name = "PermissionDependencyError";
    this.code = options.code;
    this.missing = options.missing;
  }
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string | null;
  role: "consultant" | "client" | "member" | "owner" | "admin" | "editor" | "commenter" | "viewer";
  origin?: string | null;
  has_direct_grant?: boolean;
  position?: string | null;
  capabilities?: Record<string, boolean> | null;
  permissions_json?: ProjectPermissions | null;
  joined_at?: string;
  user?: {
    id: string;
    display_name?: string;
    avatar_url?: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    is_consultant_verified?: boolean;
  };
}

export interface ProjectPermissions {
  access: {
    roadmap: boolean;
    work_items: boolean;
    team: boolean;
    chat: boolean;
    resources: boolean;
    project_settings: boolean;
  };
  roadmap: {
    view: boolean;
    edit: boolean;
    comment: boolean;
    promote: boolean;
    assign: boolean;
    edit_metadata: boolean;
    view_internal: boolean;
    create_tasks: boolean;
    edit_tasks: boolean;
    share: boolean;
    export: boolean;
    dev_mode: boolean;
  };
  members: {
    view: boolean;
    manage: boolean;
    edit_permissions: boolean;
    edit_position: boolean;
  };
  teams: {
    view: boolean;
    manage: boolean;
  };
  project: {
    settings: boolean;
    edit_content: boolean;
    view_internal_content: boolean;
  };
  chat: {
    view_channels: boolean;
    send_messages: boolean;
    create_channels: boolean;
    manage_channels: boolean;
    view_internal_channels: boolean;
    mention_members: boolean;
    share_files: boolean;
    start_dm: boolean;
    send_dm: boolean;
    message_clients: boolean;
    message_consultants: boolean;
    message_freelancers: boolean;
  };
  resources: {
    view: boolean;
    upload: boolean;
    delete: boolean;
  };
  logs: {
    view: boolean;
    view_sensitive: boolean;
  };
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

export interface ProjectResourceFolder {
  id: string;
  project_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
  links: ProjectResourceLink[];
}

export interface ProjectResourcesPayload {
  folders: ProjectResourceFolder[];
  uncategorized_links: ProjectResourceLink[];
}

export interface ProjectInvite {
  id: string;
  project_id: string;
  invited_by: string;
  invitee_id: string | null;
  invitee_email: string | null;
  invited_position: string | null;
  status: "pending" | "accepted" | "declined";
  message: string | null;
  created_at: string;
  updated_at: string;
  responded_at?: string | null;
  project?: {
    id: string;
    title: string;
    status: string;
  } | null;
  inviter?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

class ProjectService {
  private unwrapDataPayload<T>(raw: unknown): T {
    if (raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>)) {
      return (raw as { data: T }).data;
    }
    return raw as T;
  }

  private normalizeResourcesPayload(raw: unknown): ProjectResourcesPayload {
    const candidate = (
      raw &&
      typeof raw === "object" &&
      "data" in (raw as Record<string, unknown>) &&
      (raw as Record<string, unknown>).data &&
      typeof (raw as Record<string, unknown>).data === "object"
        ? (raw as Record<string, unknown>).data
        : raw
    ) as Record<string, unknown> | null;

    const foldersRaw = Array.isArray(candidate?.folders) ? candidate.folders : [];
    const uncategorizedRaw = Array.isArray(candidate?.uncategorized_links)
      ? candidate.uncategorized_links
      : [];

    const folders = foldersRaw.map((folder) => {
      const parsed = (folder ?? {}) as Record<string, unknown>;
      return {
        ...(parsed as unknown as ProjectResourceFolder),
        links: Array.isArray(parsed.links)
          ? (parsed.links as ProjectResourceLink[])
          : [],
      };
    });

    return {
      folders: folders as ProjectResourceFolder[],
      uncategorized_links: uncategorizedRaw as ProjectResourceLink[],
    };
  }

  /**
   * Create a new project
   */
  async create(data: CreateProjectData): Promise<Project> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      throw new Error("Authentication required");
    }

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(data),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(extractApiErrorMessage(error, "Failed to create project"));
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Get a project by ID
   */
  async get(projectId: string): Promise<Project> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      throw new Error("Authentication required");
    }

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(extractApiErrorMessage(error, "Failed to fetch project"));
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Update a project
   */
  async update(
    projectId: string,
    data: Partial<CreateProjectData>,
  ): Promise<Project> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      throw new Error("Authentication required");
    }

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(data),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(extractApiErrorMessage(error, "Failed to update project"));
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * List all projects for the current user
   */
  async list(): Promise<Project[]> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      throw new Error("Authentication required");
    }

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(extractApiErrorMessage(error, "Failed to fetch projects"));
    }

    const result = await response.json();
    return result.data;
  }

  async listDashboardProjects(): Promise<Project[]> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      throw new Error("Authentication required");
    }

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/dashboard`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        extractApiErrorMessage(error, "Failed to fetch dashboard projects"),
      );
    }

    const result = await response.json();
    return result.data;
  }

  async getMembers(projectId: string): Promise<ProjectMember[]> {
    const project = await this.get(projectId);
    return project.members ?? [];
  }

  async addMember(
    projectId: string,
    data: {
      email?: string;
      position: string;
    },
  ): Promise<ProjectMember> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/members`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to add member"),
      );
    }
    const result = await response.json();
    return result.data ?? result;
  }

  async updateMemberPosition(
    projectId: string,
    memberId: string,
    position: string,
  ): Promise<ProjectMember> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/members/${memberId}/position`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ position }),
      },
    );
    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to update position"),
      );
    }
    const result = await response.json();
    return result.data ?? result;
  }

  async updateMember(
    projectId: string,
    memberId: string,
    data: {
      role?: "consultant" | "client" | "member";
      position?: string;
    },
  ): Promise<ProjectMember> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/members/${memberId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to update member"),
      );
    }
    const result = await response.json();
    return result.data ?? result;
  }

  async inviteByEmail(
    projectId: string,
    data: {
      email: string;
      role?: string;
      /** Effective access on accept; persisted to project_invites.default_role. */
      default_role?: "editor" | "viewer";
      position?: string;
      message?: string;
    },
  ): Promise<ProjectInvite> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/invites`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(data),
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to send invite"),
      );
    }

    const result = await response.json();
    return result.data ?? result;
  }

  async getMyInvites(): Promise<ProjectInvite[]> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/me/invites`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to fetch invites"),
      );
    }

    const result = await response.json();
    return result.data ?? result;
  }

  async respondInvite(
    inviteId: string,
    status: "accepted" | "declined",
  ): Promise<{
    id: string;
    project_id: string;
    invited_by: string;
    status: string;
  }> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/invites/${inviteId}/respond`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ status }),
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to respond to invite"),
      );
    }

    const result = await response.json();
    return result.data ?? result;
  }

  async removeMember(projectId: string, memberId: string): Promise<void> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/members/${memberId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );
    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to remove member"),
      );
    }
  }

  async leaveProject(
    projectId: string,
  ): Promise<{ unassigned_task_count?: number } | void> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/members/leave`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to leave project"),
      );
    }

    const result = await response.json();
    return result.data ?? result;
  }

  async getMemberPermissions(
    projectId: string,
    memberId: string,
  ): Promise<ProjectPermissions> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/members/${memberId}/permissions`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        err.message ||
          err.error?.message ||
          "Failed to fetch member permissions",
      );
    }

    const result = await response.json();
    return result.data ?? result;
  }

  async getMyPermissions(projectId: string): Promise<ProjectPermissions> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/my-permissions`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        err.message ||
          err.error?.message ||
          "Failed to fetch your permissions",
      );
    }

    const result = await response.json();
    return result.data ?? result;
  }

  async updateMemberPermissions(
    projectId: string,
    memberId: string,
    data: Partial<ProjectPermissions>,
  ): Promise<ProjectPermissions> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/members/${memberId}/permissions`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(data),
      },
    );

    if (!response.ok) {
      const err = await response.json();
      // Surface the structured dependency-violation payload so the UI can
      // auto-tick prereqs and retry.
      // NestJS HttpException with object payload nests data under
      // err.message — peek into both shapes for code/missing.
      const inner =
        err?.message && typeof err.message === "object"
          ? (err.message as Record<string, unknown>)
          : err;
      const code = inner?.code ?? err?.error?.code;
      const missing = inner?.missing ?? err?.error?.missing;
      const message = extractApiErrorMessage(
        err,
        "Failed to update member permissions",
      );
      throw new PermissionDependencyError(message, {
        code: typeof code === "string" ? code : null,
        missing: Array.isArray(missing) ? missing : null,
      });
    }

    const result = await response.json();
    const payload = result.data ?? result;
    return (payload.permissions_json ?? payload) as ProjectPermissions;
  }

  async getProjectInvites(projectId: string): Promise<ProjectInvite[]> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/invites`,
      {
        headers: { Authorization: `Bearer ${session.access_token}` },
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to load project invites"),
      );
    }

    const result = await response.json();
    return (result.data ?? result) as ProjectInvite[];
  }

  async cancelInvite(projectId: string, inviteId: string): Promise<void> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/invites/${inviteId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to cancel invite"),
      );
    }
  }

  async getRolePermissions(
    projectId: string,
    role: string,
  ): Promise<ProjectPermissions | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;

    const apiRole = role === "freelancer" ? "member" : role;
    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/permissions/role?role=${apiRole}`,
      {
        headers: { Authorization: `Bearer ${session.access_token}` },
      },
    );
    if (!response.ok) return null;
    const result = await response.json();
    const payload = result.data ?? result;
    return (payload ?? null) as ProjectPermissions | null;
  }

  async updateRolePermissions(
    projectId: string,
    role: string,
    permissions: ProjectPermissions,
  ): Promise<void> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/permissions/role`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ role, permissions }),
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to update role permissions"),
      );
    }
  }

  async transferOwner(projectId: string, newOwnerId: string): Promise<Project> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/transfer-owner`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ new_owner_id: newOwnerId }),
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to transfer project owner"),
      );
    }

    const result = await response.json();
    return result.data ?? result;
  }

  async reassignConsultant(
    projectId: string,
    newConsultantId: string,
  ): Promise<Project> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/reassign-consultant`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ new_consultant_id: newConsultantId }),
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to reassign consultant"),
      );
    }

    const result = await response.json();
    return result.data ?? result;
  }

  async deleteProject(projectId: string): Promise<void> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to delete project"),
      );
    }
  }

  async getResources(projectId: string): Promise<ProjectResourcesPayload> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/resources`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to fetch resources"),
      );
    }

    const raw = await response.json();
    return this.normalizeResourcesPayload(raw);
  }

  async createResourceFolder(
    projectId: string,
    data: { name: string },
  ): Promise<ProjectResourceFolder> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/resources/folders`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(data),
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to create folder"),
      );
    }

    const result = await response.json();
    return this.unwrapDataPayload<ProjectResourceFolder>(result);
  }

  async updateResourceFolder(
    projectId: string,
    folderId: string,
    data: { name?: string },
  ): Promise<ProjectResourceFolder> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/resources/folders/${folderId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(data),
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to update folder"),
      );
    }

    const result = await response.json();
    return this.unwrapDataPayload<ProjectResourceFolder>(result);
  }

  async deleteResourceFolder(projectId: string, folderId: string): Promise<void> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/resources/folders/${folderId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to delete folder"),
      );
    }
  }

  async reorderResourceFolders(
    projectId: string,
    items: Array<{ id: string; position: number }>,
  ): Promise<ProjectResourceFolder[]> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/resources/folders/reorder`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ items }),
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to reorder folders"),
      );
    }

    const result = await response.json();
    return this.unwrapDataPayload<ProjectResourceFolder[]>(result);
  }

  async createResourceLink(
    projectId: string,
    data: {
      title: string;
      url: string;
      description?: string;
      folder_id?: string | null;
    },
  ): Promise<ProjectResourceLink> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/resources/links`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(data),
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to create link"),
      );
    }

    const result = await response.json();
    return this.unwrapDataPayload<ProjectResourceLink>(result);
  }

  async updateResourceLink(
    projectId: string,
    linkId: string,
    data: {
      title?: string;
      url?: string;
      description?: string;
      folder_id?: string | null;
    },
  ): Promise<ProjectResourceLink> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/resources/links/${linkId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(data),
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to update link"),
      );
    }

    const result = await response.json();
    return this.unwrapDataPayload<ProjectResourceLink>(result);
  }

  async deleteResourceLink(projectId: string, linkId: string): Promise<void> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/resources/links/${linkId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to delete link"),
      );
    }
  }

  async reorderResourceLinks(
    projectId: string,
    params: {
      folder_id?: string | null;
      items: Array<{ id: string; position: number }>;
    },
  ): Promise<ProjectResourceLink[]> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");

    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/api/projects/${projectId}/resources/links/reorder`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(params),
      },
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(
        extractApiErrorMessage(err, "Failed to reorder links"),
      );
    }

    const result = await response.json();
    return this.unwrapDataPayload<ProjectResourceLink[]>(result);
  }
}

export const projectService = new ProjectService();
