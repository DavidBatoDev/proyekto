export type ProjectPermissions = {
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
};

export const PERMISSION_TEMPLATES = {
  client: {
    roadmap: {
      edit: false,
      view_internal: false,
      comment: true,
      promote: false,
    },
    members: { manage: true, view: true },
    project: { settings: true },
    time: {
      log: false,
      edit_own: false,
      edit_team: false,
      approve: false,
      manage_rates: false,
      view: false,
    },
  },
  consultant: {
    roadmap: { edit: true, view_internal: true, comment: true, promote: true },
    members: { manage: true, view: true },
    project: { settings: true },
    time: {
      log: true,
      edit_own: true,
      edit_team: true,
      approve: true,
      manage_rates: true,
      view: true,
    },
  },
  consultant_incubation: {
    roadmap: { edit: true, view_internal: true, comment: true, promote: true },
    members: { manage: true, view: true },
    project: { settings: true },
    time: {
      log: true,
      edit_own: true,
      edit_team: true,
      approve: true,
      manage_rates: true,
      view: true,
    },
  },
  member: {
    roadmap: {
      edit: false,
      view_internal: false,
      comment: true,
      promote: false,
    },
    members: { manage: false, view: true },
    project: { settings: false },
    time: {
      log: true,
      edit_own: true,
      edit_team: false,
      approve: false,
      manage_rates: false,
      view: true,
    },
  },
} satisfies Record<string, ProjectPermissions>;

export type PermissionTemplateKey = keyof typeof PERMISSION_TEMPLATES;

export type ProjectMemberLike = {
  id: string;
  user_id: string | null;
  role: string;
  permissions_json?: Record<string, unknown> | null;
};

export type ProjectLike = {
  id: string;
  client_id: string;
  consultant_id?: string | null;
};

export function clonePermissions(
  template: ProjectPermissions,
): ProjectPermissions {
  return {
    roadmap: { ...template.roadmap },
    members: { ...template.members },
    project: { ...template.project },
    time: { ...template.time },
  };
}

export function getTemplateByKey(
  key: PermissionTemplateKey,
): ProjectPermissions {
  return clonePermissions(PERMISSION_TEMPLATES[key]);
}

export function normalizePermissions(
  candidate: Record<string, unknown> | null | undefined,
  defaults: ProjectPermissions,
): ProjectPermissions {
  const roadmap = (candidate?.roadmap as Record<string, unknown>) ?? {};
  const members = (candidate?.members as Record<string, unknown>) ?? {};
  const project = (candidate?.project as Record<string, unknown>) ?? {};
  const time = (candidate?.time as Record<string, unknown>) ?? {};

  return {
    roadmap: {
      edit:
        typeof roadmap.edit === 'boolean'
          ? roadmap.edit
          : defaults.roadmap.edit,
      view_internal:
        typeof roadmap.view_internal === 'boolean'
          ? roadmap.view_internal
          : defaults.roadmap.view_internal,
      comment:
        typeof roadmap.comment === 'boolean'
          ? roadmap.comment
          : defaults.roadmap.comment,
      promote:
        typeof roadmap.promote === 'boolean'
          ? roadmap.promote
          : defaults.roadmap.promote,
    },
    members: {
      manage:
        typeof members.manage === 'boolean'
          ? members.manage
          : defaults.members.manage,
      view:
        typeof members.view === 'boolean'
          ? members.view
          : defaults.members.view,
    },
    project: {
      settings:
        typeof project.settings === 'boolean'
          ? project.settings
          : defaults.project.settings,
    },
    time: {
      log: typeof time.log === 'boolean' ? time.log : defaults.time.log,
      edit_own:
        typeof time.edit_own === 'boolean'
          ? time.edit_own
          : defaults.time.edit_own,
      edit_team:
        typeof time.edit_team === 'boolean'
          ? time.edit_team
          : defaults.time.edit_team,
      approve:
        typeof time.approve === 'boolean'
          ? time.approve
          : defaults.time.approve,
      manage_rates:
        typeof time.manage_rates === 'boolean'
          ? time.manage_rates
          : defaults.time.manage_rates,
      view: typeof time.view === 'boolean' ? time.view : defaults.time.view,
    },
  };
}

export function isPermissionsEmpty(
  permissions: Record<string, unknown> | null | undefined,
): boolean {
  if (!permissions) return true;
  return Object.keys(permissions).length === 0;
}

export function resolvePermissionTemplateKey(
  project: ProjectLike,
  member: ProjectMemberLike,
): PermissionTemplateKey {
  if (member.user_id && member.user_id === project.consultant_id) {
    return 'consultant';
  }

  if (member.user_id && member.user_id === project.client_id) {
    return 'client';
  }

  const normalizedRole = String(member.role || '')
    .trim()
    .toLowerCase();

  if (normalizedRole === 'consultant') {
    return 'consultant';
  }

  if (normalizedRole === 'client') {
    return 'client';
  }

  return 'member';
}

export function hasPermission(
  permissions: ProjectPermissions,
  path:
    | 'members.manage'
    | 'members.view'
    | 'project.settings'
    | 'roadmap.edit'
    | 'roadmap.view_internal'
    | 'roadmap.comment'
    | 'roadmap.promote'
    | 'time.log'
    | 'time.edit_own'
    | 'time.edit_team'
    | 'time.approve'
    | 'time.manage_rates'
    | 'time.view',
): boolean {
  const [section, key] = path.split('.') as [keyof ProjectPermissions, string];
  const group = permissions[section] as Record<string, boolean>;
  return group?.[key] === true;
}
