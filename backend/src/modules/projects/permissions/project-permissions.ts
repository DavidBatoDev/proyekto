export type ProjectPermissions = {
  access: {
    roadmap: boolean;
    work_items: boolean;
    team: boolean;
    time: boolean;
    chat: boolean;
    resources: boolean;
    project_settings: boolean;
  };
  roadmap: {
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
  };
  project: {
    settings: boolean;
    edit_content: boolean;
    view_internal_content: boolean;
  };
  time: {
    view: boolean;
    view_financial: boolean;
    log: boolean;
    edit_own: boolean;
    edit_team: boolean;
    approve: boolean;
    manage_rates: boolean;
    delete_logs: boolean;
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
};

export const PERMISSION_TEMPLATES = {
  consultant: {
    access: {
      roadmap: true,
      work_items: true,
      team: true,
      time: true,
      chat: true,
      resources: true,
      project_settings: true,
    },
    roadmap: {
      edit: true,
      comment: true,
      promote: true,
      assign: true,
      edit_metadata: true,
      view_internal: true,
      create_tasks: true,
      edit_tasks: true,
      share: true,
      export: true,
      dev_mode: true,
    },
    members: { view: true, manage: true, edit_permissions: true },
    project: { settings: true, edit_content: true, view_internal_content: true },
    time: {
      view: true,
      view_financial: true,
      log: true,
      edit_own: true,
      edit_team: true,
      approve: true,
      manage_rates: true,
      delete_logs: true,
    },
    chat: {
      view_channels: true,
      send_messages: true,
      create_channels: true,
      manage_channels: true,
      view_internal_channels: true,
      mention_members: true,
      share_files: true,
      start_dm: true,
      send_dm: true,
      message_clients: true,
      message_consultants: true,
      message_freelancers: true,
    },
    resources: { view: true, upload: true, delete: true },
    logs: { view: true, view_sensitive: true },
  },
  consultant_incubation: {
    access: {
      roadmap: true,
      work_items: true,
      team: true,
      time: true,
      chat: true,
      resources: true,
      project_settings: true,
    },
    roadmap: {
      edit: true,
      comment: true,
      promote: true,
      assign: true,
      edit_metadata: true,
      view_internal: true,
      create_tasks: true,
      edit_tasks: true,
      share: true,
      export: true,
      dev_mode: true,
    },
    members: { view: true, manage: true, edit_permissions: true },
    project: { settings: true, edit_content: true, view_internal_content: true },
    time: {
      view: true,
      view_financial: true,
      log: true,
      edit_own: true,
      edit_team: true,
      approve: true,
      manage_rates: true,
      delete_logs: true,
    },
    chat: {
      view_channels: true,
      send_messages: true,
      create_channels: true,
      manage_channels: true,
      view_internal_channels: true,
      mention_members: true,
      share_files: true,
      start_dm: true,
      send_dm: true,
      message_clients: true,
      message_consultants: true,
      message_freelancers: true,
    },
    resources: { view: true, upload: true, delete: true },
    logs: { view: true, view_sensitive: true },
  },
  client: {
    access: {
      roadmap: true,
      work_items: true,
      team: true,
      time: false,
      chat: true,
      resources: true,
      project_settings: false,
    },
    roadmap: {
      edit: true,
      comment: true,
      promote: true,
      assign: false,
      edit_metadata: true,
      view_internal: false,
      create_tasks: false,
      edit_tasks: false,
      share: false,
      export: false,
      dev_mode: false,
    },
    members: { view: true, manage: false, edit_permissions: false },
    project: { settings: false, edit_content: true, view_internal_content: false },
    time: {
      view: false,
      view_financial: false,
      log: false,
      edit_own: false,
      edit_team: false,
      approve: false,
      manage_rates: false,
      delete_logs: false,
    },
    chat: {
      view_channels: true,
      send_messages: true,
      create_channels: false,
      manage_channels: false,
      view_internal_channels: false,
      mention_members: true,
      share_files: true,
      start_dm: true,
      send_dm: true,
      message_clients: false,
      message_consultants: true,
      message_freelancers: false,
    },
    resources: { view: true, upload: true, delete: false },
    logs: { view: false, view_sensitive: false },
  },
  freelancer: {
    access: {
      roadmap: true,
      work_items: true,
      team: true,
      time: false,
      chat: true,
      resources: true,
      project_settings: false,
    },
    roadmap: {
      edit: false,
      comment: true,
      promote: false,
      assign: false,
      edit_metadata: false,
      view_internal: false,
      create_tasks: true,
      edit_tasks: true,
      share: false,
      export: false,
      dev_mode: false,
    },
    members: { view: true, manage: false, edit_permissions: false },
    project: { settings: false, edit_content: false, view_internal_content: false },
    time: {
      view: false,
      view_financial: false,
      log: true,
      edit_own: true,
      edit_team: false,
      approve: false,
      manage_rates: false,
      delete_logs: false,
    },
    chat: {
      view_channels: true,
      send_messages: true,
      create_channels: false,
      manage_channels: false,
      view_internal_channels: false,
      mention_members: true,
      share_files: true,
      start_dm: true,
      send_dm: true,
      message_clients: false,
      message_consultants: true,
      message_freelancers: true,
    },
    resources: { view: true, upload: true, delete: false },
    logs: { view: false, view_sensitive: false },
  },
  member: {
    access: {
      roadmap: true,
      work_items: true,
      team: true,
      time: false,
      chat: true,
      resources: true,
      project_settings: false,
    },
    roadmap: {
      edit: false,
      comment: true,
      promote: false,
      assign: false,
      edit_metadata: false,
      view_internal: false,
      create_tasks: true,
      edit_tasks: true,
      share: false,
      export: false,
      dev_mode: false,
    },
    members: { view: true, manage: false, edit_permissions: false },
    project: { settings: false, edit_content: false, view_internal_content: false },
    time: {
      view: false,
      view_financial: false,
      log: true,
      edit_own: true,
      edit_team: false,
      approve: false,
      manage_rates: false,
      delete_logs: false,
    },
    chat: {
      view_channels: true,
      send_messages: true,
      create_channels: false,
      manage_channels: false,
      view_internal_channels: false,
      mention_members: true,
      share_files: true,
      start_dm: true,
      send_dm: true,
      message_clients: false,
      message_consultants: true,
      message_freelancers: true,
    },
    resources: { view: true, upload: true, delete: false },
    logs: { view: false, view_sensitive: false },
  },
} satisfies Record<string, ProjectPermissions>;

export type PermissionTemplateKey = keyof typeof PERMISSION_TEMPLATES;

// Each entry: [childSection, childKey, parentSection, parentKey]
export const PERMISSION_DEPENDENCIES: Array<
  [keyof ProjectPermissions, string, keyof ProjectPermissions, string]
> = [
  ['access', 'work_items', 'access', 'roadmap'],
  ['roadmap', 'edit', 'access', 'roadmap'],
  ['roadmap', 'comment', 'access', 'roadmap'],
  ['roadmap', 'promote', 'access', 'roadmap'],
  ['roadmap', 'assign', 'access', 'roadmap'],
  ['roadmap', 'assign', 'members', 'view'],
  ['roadmap', 'edit_metadata', 'access', 'roadmap'],
  ['roadmap', 'view_internal', 'access', 'roadmap'],
  ['roadmap', 'create_tasks', 'access', 'roadmap'],
  ['roadmap', 'edit_tasks', 'access', 'roadmap'],
  ['roadmap', 'share', 'access', 'roadmap'],
  ['roadmap', 'export', 'access', 'roadmap'],
  ['roadmap', 'dev_mode', 'access', 'roadmap'],
  ['members', 'manage', 'members', 'view'],
  ['members', 'edit_permissions', 'members', 'view'],
  ['project', 'settings', 'access', 'project_settings'],
  ['project', 'edit_content', 'access', 'project_settings'],
  ['project', 'view_internal_content', 'access', 'project_settings'],
  ['time', 'view_financial', 'time', 'view'],
  ['time', 'log', 'time', 'view'],
  ['time', 'edit_own', 'time', 'view'],
  ['time', 'edit_team', 'time', 'view'],
  ['time', 'approve', 'time', 'view'],
  ['time', 'manage_rates', 'time', 'view'],
  ['time', 'delete_logs', 'time', 'edit_team'],
  ['chat', 'view_channels', 'access', 'chat'],
  ['chat', 'send_messages', 'access', 'chat'],
  ['chat', 'send_messages', 'chat', 'view_channels'],
  ['chat', 'create_channels', 'access', 'chat'],
  ['chat', 'create_channels', 'chat', 'view_channels'],
  ['chat', 'manage_channels', 'access', 'chat'],
  ['chat', 'manage_channels', 'chat', 'view_channels'],
  ['chat', 'view_internal_channels', 'access', 'chat'],
  ['chat', 'view_internal_channels', 'chat', 'view_channels'],
  ['chat', 'mention_members', 'chat', 'send_messages'],
  ['chat', 'share_files', 'chat', 'send_messages'],
  ['chat', 'start_dm', 'access', 'chat'],
  ['chat', 'send_dm', 'chat', 'start_dm'],
  ['chat', 'message_clients', 'chat', 'start_dm'],
  ['chat', 'message_clients', 'chat', 'send_dm'],
  ['chat', 'message_consultants', 'chat', 'start_dm'],
  ['chat', 'message_consultants', 'chat', 'send_dm'],
  ['chat', 'message_freelancers', 'chat', 'start_dm'],
  ['chat', 'message_freelancers', 'chat', 'send_dm'],
  ['resources', 'upload', 'resources', 'view'],
  ['resources', 'delete', 'resources', 'view'],
  ['logs', 'view_sensitive', 'logs', 'view'],
];

export type ProjectMemberLike = {
  id: string;
  user_id: string | null;
  role: string;
  member_type?: string | null;
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
    access: { ...template.access },
    roadmap: { ...template.roadmap },
    members: { ...template.members },
    project: { ...template.project },
    time: { ...template.time },
    chat: { ...template.chat },
    resources: { ...template.resources },
    logs: { ...template.logs },
  };
}

export function getTemplateByKey(
  key: PermissionTemplateKey,
): ProjectPermissions {
  return clonePermissions(PERMISSION_TEMPLATES[key]);
}

export function applyClientInviteRestrictions(
  permissions: ProjectPermissions,
  invitedByClient: boolean,
): ProjectPermissions {
  const normalized = clonePermissions(permissions);
  if (!invitedByClient) return normalized;

  normalized.roadmap.edit = false;
  normalized.time.view = false;
  return normalized;
}

function bool(
  candidate: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  return typeof candidate[key] === 'boolean'
    ? (candidate[key] as boolean)
    : fallback;
}

export function normalizePermissions(
  candidate: Record<string, unknown> | null | undefined,
  defaults: ProjectPermissions,
): ProjectPermissions {
  const access = (candidate?.access as Record<string, unknown>) ?? {};
  const roadmap = (candidate?.roadmap as Record<string, unknown>) ?? {};
  const members = (candidate?.members as Record<string, unknown>) ?? {};
  const project = (candidate?.project as Record<string, unknown>) ?? {};
  const time = (candidate?.time as Record<string, unknown>) ?? {};
  const chat = (candidate?.chat as Record<string, unknown>) ?? {};
  const resources = (candidate?.resources as Record<string, unknown>) ?? {};
  const logs = (candidate?.logs as Record<string, unknown>) ?? {};

  return {
    access: {
      roadmap: bool(access, 'roadmap', defaults.access.roadmap),
      work_items: bool(access, 'work_items', defaults.access.work_items),
      team: bool(access, 'team', defaults.access.team),
      time: bool(access, 'time', defaults.access.time),
      chat: bool(access, 'chat', defaults.access.chat),
      resources: bool(access, 'resources', defaults.access.resources),
      project_settings: bool(
        access,
        'project_settings',
        defaults.access.project_settings,
      ),
    },
    roadmap: {
      edit: bool(roadmap, 'edit', defaults.roadmap.edit),
      comment: bool(roadmap, 'comment', defaults.roadmap.comment),
      promote: bool(roadmap, 'promote', defaults.roadmap.promote),
      assign: bool(roadmap, 'assign', defaults.roadmap.assign),
      edit_metadata: bool(
        roadmap,
        'edit_metadata',
        defaults.roadmap.edit_metadata,
      ),
      view_internal: bool(
        roadmap,
        'view_internal',
        defaults.roadmap.view_internal,
      ),
      create_tasks: bool(roadmap, 'create_tasks', defaults.roadmap.create_tasks),
      edit_tasks: bool(roadmap, 'edit_tasks', defaults.roadmap.edit_tasks),
      share: bool(roadmap, 'share', defaults.roadmap.share),
      export: bool(roadmap, 'export', defaults.roadmap.export),
      dev_mode: bool(roadmap, 'dev_mode', defaults.roadmap.dev_mode),
    },
    members: {
      view: bool(members, 'view', defaults.members.view),
      manage: bool(members, 'manage', defaults.members.manage),
      edit_permissions: bool(
        members,
        'edit_permissions',
        defaults.members.edit_permissions,
      ),
    },
    project: {
      settings: bool(project, 'settings', defaults.project.settings),
      edit_content: bool(project, 'edit_content', defaults.project.edit_content),
      view_internal_content: bool(
        project,
        'view_internal_content',
        defaults.project.view_internal_content,
      ),
    },
    time: {
      view: bool(time, 'view', defaults.time.view),
      view_financial: bool(time, 'view_financial', defaults.time.view_financial),
      log: bool(time, 'log', defaults.time.log),
      edit_own: bool(time, 'edit_own', defaults.time.edit_own),
      edit_team: bool(time, 'edit_team', defaults.time.edit_team),
      approve: bool(time, 'approve', defaults.time.approve),
      manage_rates: bool(time, 'manage_rates', defaults.time.manage_rates),
      delete_logs: bool(time, 'delete_logs', defaults.time.delete_logs),
    },
    chat: {
      view_channels: bool(chat, 'view_channels', defaults.chat.view_channels),
      send_messages: bool(chat, 'send_messages', defaults.chat.send_messages),
      create_channels: bool(
        chat,
        'create_channels',
        defaults.chat.create_channels,
      ),
      manage_channels: bool(
        chat,
        'manage_channels',
        defaults.chat.manage_channels,
      ),
      view_internal_channels: bool(
        chat,
        'view_internal_channels',
        defaults.chat.view_internal_channels,
      ),
      mention_members: bool(
        chat,
        'mention_members',
        defaults.chat.mention_members,
      ),
      share_files: bool(chat, 'share_files', defaults.chat.share_files),
      start_dm: bool(chat, 'start_dm', defaults.chat.start_dm),
      send_dm: bool(chat, 'send_dm', defaults.chat.send_dm),
      message_clients: bool(
        chat,
        'message_clients',
        defaults.chat.message_clients,
      ),
      message_consultants: bool(
        chat,
        'message_consultants',
        defaults.chat.message_consultants,
      ),
      message_freelancers: bool(
        chat,
        'message_freelancers',
        defaults.chat.message_freelancers,
      ),
    },
    resources: {
      view: bool(resources, 'view', defaults.resources.view),
      upload: bool(resources, 'upload', defaults.resources.upload),
      delete: bool(resources, 'delete', defaults.resources.delete),
    },
    logs: {
      view: bool(logs, 'view', defaults.logs.view),
      view_sensitive: bool(logs, 'view_sensitive', defaults.logs.view_sensitive),
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

  const memberType = String(member.member_type || '')
    .trim()
    .toLowerCase();

  if (memberType === 'freelancer') {
    return 'freelancer';
  }

  return 'member';
}

export type PermissionPath =
  | 'access.roadmap'
  | 'access.work_items'
  | 'access.team'
  | 'access.time'
  | 'access.chat'
  | 'access.resources'
  | 'access.project_settings'
  | 'roadmap.edit'
  | 'roadmap.comment'
  | 'roadmap.promote'
  | 'roadmap.assign'
  | 'roadmap.edit_metadata'
  | 'roadmap.view_internal'
  | 'roadmap.create_tasks'
  | 'roadmap.edit_tasks'
  | 'roadmap.share'
  | 'roadmap.export'
  | 'roadmap.dev_mode'
  | 'members.view'
  | 'members.manage'
  | 'members.edit_permissions'
  | 'project.settings'
  | 'project.edit_content'
  | 'project.view_internal_content'
  | 'time.view'
  | 'time.view_financial'
  | 'time.log'
  | 'time.edit_own'
  | 'time.edit_team'
  | 'time.approve'
  | 'time.manage_rates'
  | 'time.delete_logs'
  | 'chat.view_channels'
  | 'chat.send_messages'
  | 'chat.create_channels'
  | 'chat.manage_channels'
  | 'chat.view_internal_channels'
  | 'chat.mention_members'
  | 'chat.share_files'
  | 'chat.start_dm'
  | 'chat.send_dm'
  | 'chat.message_clients'
  | 'chat.message_consultants'
  | 'chat.message_freelancers'
  | 'resources.view'
  | 'resources.upload'
  | 'resources.delete'
  | 'logs.view'
  | 'logs.view_sensitive';

export function hasPermission(
  permissions: ProjectPermissions,
  path: PermissionPath,
): boolean {
  const [section, key] = path.split('.') as [keyof ProjectPermissions, string];
  const group = permissions[section] as Record<string, boolean>;
  return group?.[key] === true;
}

export function enforceDependencies(
  permissions: ProjectPermissions,
): ProjectPermissions {
  const result = clonePermissions(permissions);
  let changed = true;

  while (changed) {
    changed = false;
    for (const [
      childSection,
      childKey,
      parentSection,
      parentKey,
    ] of PERMISSION_DEPENDENCIES) {
      const parentGroup = result[parentSection] as Record<string, boolean>;
      const childGroup = result[childSection] as Record<string, boolean>;
      if (!parentGroup[parentKey] && childGroup[childKey]) {
        childGroup[childKey] = false;
        changed = true;
      }
    }
  }

  return result;
}
