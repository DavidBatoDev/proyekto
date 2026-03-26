import { supabase } from "@/lib/supabase";

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

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string | null;
  role: "consultant" | "client" | "member";
  position?: string | null;
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
  roadmap: {
    edit: boolean;
    view_internal: boolean;
    comment: boolean;
    promote: boolean;
  };
  members: {
    manage: boolean;
    view: boolean;
  };
  project: {
    settings: boolean;
  };
  time: {
    log: boolean;
    edit_own: boolean;
    edit_team: boolean;
    approve: boolean;
    manage_rates: boolean;
    view: boolean;
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
      throw new Error(error.error?.message || "Failed to create project");
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
      throw new Error(error.error?.message || "Failed to fetch project");
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
      throw new Error(error.error?.message || "Failed to update project");
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
      throw new Error(error.error?.message || "Failed to fetch projects");
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
        error.error?.message || "Failed to fetch dashboard projects",
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
        err.message || err.error?.message || "Failed to add member",
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
        err.message || err.error?.message || "Failed to update member",
      );
    }
    const result = await response.json();
    return result.data ?? result;
  }

  async inviteByEmail(
    projectId: string,
    data: {
      email: string;
      position: string;
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
        err.message || err.error?.message || "Failed to send invite",
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
        err.message || err.error?.message || "Failed to fetch invites",
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
        err.message || err.error?.message || "Failed to respond to invite",
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
        err.message || err.error?.message || "Failed to remove member",
      );
    }
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
      throw new Error(
        err.message ||
          err.error?.message ||
          "Failed to update member permissions",
      );
    }

    const result = await response.json();
    const payload = result.data ?? result;
    return (payload.permissions_json ?? payload) as ProjectPermissions;
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
        err.message || err.error?.message || "Failed to transfer project owner",
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
        err.message || err.error?.message || "Failed to reassign consultant",
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
        err.message || err.error?.message || "Failed to delete project",
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
        err.message || err.error?.message || "Failed to fetch resources",
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
        err.message || err.error?.message || "Failed to create folder",
      );
    }

    return (await response.json()) as ProjectResourceFolder;
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
        err.message || err.error?.message || "Failed to update folder",
      );
    }

    return (await response.json()) as ProjectResourceFolder;
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
        err.message || err.error?.message || "Failed to delete folder",
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
        err.message || err.error?.message || "Failed to reorder folders",
      );
    }

    return (await response.json()) as ProjectResourceFolder[];
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
        err.message || err.error?.message || "Failed to create link",
      );
    }

    return (await response.json()) as ProjectResourceLink;
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
        err.message || err.error?.message || "Failed to update link",
      );
    }

    return (await response.json()) as ProjectResourceLink;
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
        err.message || err.error?.message || "Failed to delete link",
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
        err.message || err.error?.message || "Failed to reorder links",
      );
    }

    return (await response.json()) as ProjectResourceLink[];
  }
}

export const projectService = new ProjectService();
