// IAM-style fine-grained permissions for project_access.
//
// Permissions are computed at every check via:
//
//   resolvePermissions(role, capabilities)
//     = ROLE_DEFAULTS[role]
//     ⊕ capabilities          // flat path overrides win, and may deny
//
// Two inputs, deliberately. How a member came to be on the project
// (`project_access.origin`) does NOT affect what they can do — a project is the
// execution layer, so it has members with permissions, not a client and a
// consultant. See the note where ORIGIN_DELTAS used to be.
//
// Capabilities are stored on `project_access.capabilities` (JSONB) as a flat map
// of { 'roadmap.edit': true, 'members.edit_position': true } — only the *delta*
// from the role baseline is persisted, so rows stay small and templates can
// evolve without backfill.

export type ProjectRole = 'viewer' | 'commenter' | 'editor' | 'admin' | 'owner';

/** Weakest to strongest. */
const ROLE_ORDER: readonly ProjectRole[] = [
  'viewer',
  'commenter',
  'editor',
  'admin',
  'owner',
];

/**
 * True when `actual` is at least as strong as `required`.
 *
 * Lives here, beside the `ProjectRole` union, because this module has no service
 * dependencies — `ProjectAuthorizationService` (which owns the equivalent check
 * used for enforcement) imports `ProjectsService`, so importing its `PROJECT_ROLES`
 * back into the service layer would be a module cycle.
 *
 * NOTE: this is deliberately NOT `permissions.members.manage`. That looks like the
 * same predicate and is not: a per-member capability can grant `members.manage` to
 * an editor, who `assertRole('admin')` would then refuse. Anything that must agree
 * with enforcement has to compare roles. (The divergence used to come from
 * ORIGIN_DELTAS granting it by origin; capabilities produce the same gap.)
 */
export function roleSatisfies(
  actual: ProjectRole,
  required: ProjectRole,
): boolean {
  return ROLE_ORDER.indexOf(actual) >= ROLE_ORDER.indexOf(required);
}

// ─── Permission paths ──────────────────────────────────────────────────────

export type ProjectPermissions = {
  access: {
    roadmap: boolean;
    work_items: boolean;
    team: boolean;
    chat: boolean;
    resources: boolean;
    project_settings: boolean;
    time: boolean;
    /**
     * One gate for the whole delivery-governance group — Deliverables, Change
     * Requests, Risks & Issues, Decisions.
     *
     * Deliberately a single key rather than one per page: every `access.*` key
     * has to be hand-mirrored into three web files with no automated check, and
     * these four surfaces are always granted and revoked together.
     */
    delivery: boolean;
  };
  deliverables: {
    edit: boolean;
    /** Accept or bounce a submitted deliverable. Clients get this by origin. */
    approve: boolean;
  };
  change_requests: {
    create: boolean;
    /** Approve, reject, or send back a change request. */
    decide: boolean;
  };
  risks: {
    edit: boolean;
    /** See risks marked `internal`. */
    view_internal: boolean;
  };
  decisions: {
    edit: boolean;
    /** See decisions marked `internal`. Mirrors `risks.view_internal`. */
    view_internal: boolean;
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
  time: {
    /** See every member's time on the project, not just your own. */
    view_team_logs: boolean;
  };
  /**
   * Feature availability, NOT a per-member capability — and deliberately absent
   * from `PermissionPath`/`PERMISSION_PATHS`.
   *
   * Everything in the path machinery can be granted or revoked per member by an
   * admin (see `members.edit_permissions` and `diffCapabilities`). This flag is
   * different in kind: it answers "is this feature switched on, and is this
   * caller senior enough", and an admin handing it to a viewer would be
   * meaningless. Keeping it out of the paths also means `allTrue()` cannot
   * fabricate it for an owner — `ProjectsService.getMyPermissions` is the only
   * thing that ever sets it true.
   */
  mentions: {
    /** Can this caller invite someone by @mentioning an email address? */
    invite_by_email: boolean;
  };
};

export type PermissionPath =
  | 'access.roadmap'
  | 'access.work_items'
  | 'access.team'
  | 'access.chat'
  | 'access.resources'
  | 'access.project_settings'
  | 'access.time'
  | 'access.delivery'
  | 'deliverables.edit'
  | 'deliverables.approve'
  | 'change_requests.create'
  | 'change_requests.decide'
  | 'risks.edit'
  | 'risks.view_internal'
  | 'decisions.edit'
  | 'decisions.view_internal'
  | 'roadmap.view'
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
  | 'members.edit_position'
  | 'teams.view'
  | 'teams.manage'
  | 'project.settings'
  | 'project.edit_content'
  | 'project.view_internal_content'
  | 'chat.view_channels'
  | 'chat.send_messages'
  | 'chat.create_channels'
  | 'chat.manage_channels'
  | 'chat.view_internal_channels'
  | 'chat.mention_members'
  | 'chat.share_files'
  | 'chat.start_dm'
  | 'chat.send_dm'
  | 'resources.view'
  | 'resources.upload'
  | 'resources.delete'
  | 'logs.view'
  | 'logs.view_sensitive'
  | 'time.view_team_logs';

// Runtime list — handy for iteration in dep validation and the UI.
export const PERMISSION_PATHS: readonly PermissionPath[] = [
  'access.roadmap',
  'access.work_items',
  'access.team',
  'access.chat',
  'access.resources',
  'access.project_settings',
  'access.time',
  'access.delivery',
  'deliverables.edit',
  'deliverables.approve',
  'change_requests.create',
  'change_requests.decide',
  'risks.edit',
  'risks.view_internal',
  'decisions.edit',
  'decisions.view_internal',
  'roadmap.view',
  'roadmap.edit',
  'roadmap.comment',
  'roadmap.promote',
  'roadmap.assign',
  'roadmap.edit_metadata',
  'roadmap.view_internal',
  'roadmap.create_tasks',
  'roadmap.edit_tasks',
  'roadmap.share',
  'roadmap.export',
  'roadmap.dev_mode',
  'members.view',
  'members.manage',
  'members.edit_permissions',
  'members.edit_position',
  'teams.view',
  'teams.manage',
  'project.settings',
  'project.edit_content',
  'project.view_internal_content',
  'chat.view_channels',
  'chat.send_messages',
  'chat.create_channels',
  'chat.manage_channels',
  'chat.view_internal_channels',
  'chat.mention_members',
  'chat.share_files',
  'chat.start_dm',
  'chat.send_dm',
  'resources.view',
  'resources.upload',
  'resources.delete',
  'logs.view',
  'logs.view_sensitive',
  'time.view_team_logs',
] as const;

// ─── Path helpers ──────────────────────────────────────────────────────────

/**
 * Every section of `ProjectPermissions` is a flat bag of booleans, so a path can
 * be resolved structurally. Typed rather than cast to `any`: these two helpers are
 * the only writers of the permission object, and an `any` here silently swallowed
 * the unknown-path bugs described on `setPermission`.
 */
type PermissionSection = Record<string, boolean>;

function sectionOf(
  perms: ProjectPermissions,
  section: string,
): PermissionSection | undefined {
  return (perms as unknown as Record<string, PermissionSection | undefined>)[
    section
  ];
}

export function getPermission(
  perms: ProjectPermissions,
  path: PermissionPath,
): boolean {
  const [section, field] = path.split('.');
  return Boolean(sectionOf(perms, section)?.[field]);
}

/**
 * Set one path, ignoring anything the catalog does not declare.
 *
 * The guard is not defensive noise: `applyPaths` feeds this from
 * `project_access.capabilities`, which is stored JSON and therefore may name a
 * path that has since been retired — the three `chat.message_*` keys deleted with
 * the persona model being the live example. Without the guard, an unknown SECTION
 * threw a TypeError (`undefined[field] = value`) and an unknown FIELD silently
 * added a stray key to the resolved payload, re-exposing a permission the type no
 * longer has.
 *
 * Trusted callers are unaffected: every path in `PERMISSION_PATHS` exists on the
 * `allFalse()` shape, so a real path is never skipped.
 */
export function setPermission(
  perms: ProjectPermissions,
  path: PermissionPath,
  value: boolean,
): void {
  const [section, field] = path.split('.');
  const target = sectionOf(perms, section);
  if (!target || !Object.hasOwn(target, field)) return;
  target[field] = value;
}

// ─── Baselines ─────────────────────────────────────────────────────────────

function allFalse(): ProjectPermissions {
  return {
    access: {
      roadmap: false,
      work_items: false,
      team: false,
      chat: false,
      resources: false,
      project_settings: false,
      time: false,
      delivery: false,
    },
    deliverables: { edit: false, approve: false },
    change_requests: { create: false, decide: false },
    risks: { edit: false, view_internal: false },
    decisions: { edit: false, view_internal: false },
    roadmap: {
      view: false,
      edit: false,
      comment: false,
      promote: false,
      assign: false,
      edit_metadata: false,
      view_internal: false,
      create_tasks: false,
      edit_tasks: false,
      share: false,
      export: false,
      dev_mode: false,
    },
    members: {
      view: false,
      manage: false,
      edit_permissions: false,
      edit_position: false,
    },
    teams: {
      view: false,
      manage: false,
    },
    project: {
      settings: false,
      edit_content: false,
      view_internal_content: false,
    },
    chat: {
      view_channels: false,
      send_messages: false,
      create_channels: false,
      manage_channels: false,
      view_internal_channels: false,
      mention_members: false,
      share_files: false,
      start_dm: false,
      send_dm: false,
    },
    resources: { view: false, upload: false, delete: false },
    logs: { view: false, view_sensitive: false },
    time: { view_team_logs: false },
    // Not reachable via setPermission, so allTrue() leaves it false. Resolved
    // only in ProjectsService.getMyPermissions.
    mentions: { invite_by_email: false },
  };
}

function allTrue(): ProjectPermissions {
  const p = allFalse();
  for (const path of PERMISSION_PATHS) setPermission(p, path, true);
  return p;
}

function applyPaths(
  base: ProjectPermissions,
  overrides: Partial<Record<PermissionPath, boolean>>,
): ProjectPermissions {
  for (const [path, value] of Object.entries(overrides)) {
    if (typeof value === 'boolean') {
      setPermission(base, path as PermissionPath, value);
    }
  }
  return base;
}

// Role baselines — coarse defaults; origin deltas + capabilities can elevate.
//
// viewer:     read everything they have access to
// commenter:  + comment/dm
// editor:     + edit work, log time, send messages
// admin:      + manage members, channels, financials
// owner:      everything
function buildRoleDefault(role: ProjectRole): ProjectPermissions {
  const p = allFalse();
  if (role === 'owner') return allTrue();

  // Base reads available from viewer up
  applyPaths(p, {
    'access.roadmap': true,
    'access.work_items': true,
    'access.team': true,
    'access.chat': true,
    'access.resources': true,
    'access.project_settings': false,
    // Everyone who can see the project can open Time — but they only get their
    // OWN logs there. Seeing the rest of the team's time is
    // `time.view_team_logs`, granted at admin and to the consultant below.
    'access.time': true,
    // Deliverables / Change Requests / Risks / Decisions are readable by anyone
    // who can see the project; the verbs below are what actually differ.
    'access.delivery': true,
    // The money surfaces are off at this rung by default; the billing three
    // (contract/invoices/financials) are granted further up the ladder.
    'roadmap.view': true,
    'roadmap.export': true,
    'members.view': true,
    'teams.view': true,
    'chat.view_channels': true,
    'resources.view': true,
    'logs.view': true,
  });

  if (role === 'viewer') return p;

  // Commenter adds: comment, send messages, mention, dm
  applyPaths(p, {
    'roadmap.comment': true,
    'chat.send_messages': true,
    'chat.mention_members': true,
    'chat.start_dm': true,
    'chat.send_dm': true,
    // Raising a change request is asking a question about scope, not editing it.
    'change_requests.create': true,
  });

  if (role === 'commenter') return p;

  // Editor adds: edit roadmap, tasks, files, time logging, share files
  applyPaths(p, {
    'roadmap.edit': true,
    'roadmap.assign': true,
    'roadmap.edit_metadata': true,
    'roadmap.create_tasks': true,
    'roadmap.edit_tasks': true,
    'roadmap.share': true,
    'chat.share_files': true,
    'resources.upload': true,
    'deliverables.edit': true,
    'risks.edit': true,
    // Recording a decision is describing what the team chose, not changing what
    // the project is committed to — the same tier as editing a deliverable.
    'decisions.edit': true,
  });

  if (role === 'editor') return p;

  // Admin adds: members, channels, financials, settings, internals
  applyPaths(p, {
    'access.project_settings': true,
    'time.view_team_logs': true,
    'roadmap.promote': true,
    'roadmap.view_internal': true,
    'roadmap.dev_mode': true,
    'members.manage': true,
    'members.edit_permissions': true,
    'members.edit_position': true,
    'teams.manage': true,
    'project.settings': true,
    'project.edit_content': true,
    'project.view_internal_content': true,
    'chat.create_channels': true,
    'chat.manage_channels': true,
    'chat.view_internal_channels': true,
    'resources.delete': true,
    'logs.view_sensitive': true,
    'deliverables.approve': true,
    'change_requests.decide': true,
    'risks.view_internal': true,
    'decisions.view_internal': true,
  });

  return p;
}

export const ROLE_DEFAULTS: Record<ProjectRole, ProjectPermissions> = {
  viewer: buildRoleDefault('viewer'),
  commenter: buildRoleDefault('commenter'),
  editor: buildRoleDefault('editor'),
  admin: buildRoleDefault('admin'),
  owner: buildRoleDefault('owner'),
};

/*
 * There are deliberately no origin deltas.
 *
 * `ORIGIN_DELTAS` used to patch permissions by how a member came to be on the
 * project — a `client` origin denied internal risks, a `consultant` origin added
 * the operator toolkit. That made a project assume it had a client and a
 * consultant, which the execution layer must not do: a project has MEMBERS with a
 * permissions catalog, and nothing else.
 *
 * It was also almost entirely dead weight. Every origin except `client` was paired
 * in production with a role whose baseline already granted everything the delta
 * did — consultant and personal_workspace are always `owner`, and `invited` was
 * empty — and `effective-permissions.spec.ts` proves that combination by
 * combination. The `client` delta's only live effect was denying three paths
 * (`time.view_team_logs`, `risks.view_internal`, `decisions.view_internal`) to
 * client-origin admins; those were deliberately released when this was removed.
 *
 * Permissions now resolve from exactly two inputs: the role ladder, and the
 * per-member `capabilities` override.
 */

// ─── Dependencies ──────────────────────────────────────────────────────────

export const PERMISSION_DEPENDENCIES: Partial<
  Record<PermissionPath, PermissionPath[]>
> = {
  'roadmap.edit': ['roadmap.view', 'access.roadmap'],
  'roadmap.promote': ['roadmap.edit'],
  'roadmap.assign': ['roadmap.edit'],
  'roadmap.create_tasks': ['roadmap.view'],
  'roadmap.edit_tasks': ['roadmap.view'],
  'roadmap.view_internal': ['roadmap.view'],
  'roadmap.share': ['roadmap.edit'],
  'roadmap.export': ['roadmap.view'],
  'roadmap.dev_mode': ['roadmap.edit'],
  'roadmap.comment': ['roadmap.view'],
  'roadmap.edit_metadata': ['roadmap.edit'],

  'members.manage': ['members.view'],
  'members.edit_permissions': ['members.manage'],
  'members.edit_position': ['members.view'],

  'teams.manage': ['teams.view'],

  'chat.send_messages': ['chat.view_channels'],
  'chat.create_channels': ['chat.view_channels'],
  'chat.manage_channels': ['chat.create_channels'],
  'chat.view_internal_channels': ['chat.view_channels'],
  'chat.mention_members': ['chat.view_channels'],
  'chat.share_files': ['chat.send_messages'],
  'chat.send_dm': ['chat.start_dm'],

  'resources.upload': ['resources.view'],
  'resources.delete': ['resources.upload'],

  'project.edit_content': ['access.project_settings'],
  'project.view_internal_content': ['access.project_settings'],
  'project.settings': ['access.project_settings'],

  'logs.view_sensitive': ['logs.view'],

  'time.view_team_logs': ['access.time'],

  'deliverables.edit': ['access.delivery'],
  'deliverables.approve': ['access.delivery'],
  'change_requests.create': ['access.delivery'],
  'change_requests.decide': ['access.delivery'],
  'risks.edit': ['access.delivery'],
  'risks.view_internal': ['access.delivery'],
  'decisions.edit': ['access.delivery'],
  'decisions.view_internal': ['access.delivery'],
};

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Compute the resolved fine-grained permissions for a `project_access` row.
 *
 * Two layers, in order: role baseline → capabilities overrides. `capabilities` is
 * a flat `{ 'section.field': boolean }` map, applied last, and can deny as well as
 * grant.
 *
 * How the member joined the project (`project_access.origin`) deliberately does
 * NOT participate — see the note where ORIGIN_DELTAS used to be.
 */
export function resolvePermissions(
  role: ProjectRole,
  capabilities: Record<string, unknown> | null | undefined,
): ProjectPermissions {
  // Deep clone the role baseline so we don't mutate the constant. structuredClone
  // rather than JSON round-tripping: it is typed, so the result is not `any`.
  const base: ProjectPermissions = structuredClone(ROLE_DEFAULTS[role]);

  if (capabilities && typeof capabilities === 'object') {
    const flat: Partial<Record<PermissionPath, boolean>> = {};
    for (const [path, value] of Object.entries(capabilities)) {
      if (typeof value === 'boolean') {
        flat[path as PermissionPath] = value;
      }
    }
    applyPaths(base, flat);
  }

  return base;
}

export type DependencyViolation = {
  path: PermissionPath;
  requires: PermissionPath[];
};

/**
 * Verify every granted (true) permission has its prerequisites also granted.
 * Returns either ok or the list of violations.
 */
export function validateDependencies(
  perms: ProjectPermissions,
): { ok: true } | { ok: false; missing: DependencyViolation[] } {
  const missing: DependencyViolation[] = [];
  for (const [path, requires] of Object.entries(PERMISSION_DEPENDENCIES)) {
    if (!requires) continue;
    const granted = getPermission(perms, path as PermissionPath);
    if (!granted) continue;
    const unmet = requires.filter((req) => !getPermission(perms, req));
    if (unmet.length > 0) {
      missing.push({ path: path as PermissionPath, requires: unmet });
    }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

/**
 * Compute the capabilities delta — the minimal set of path→boolean entries that,
 * layered on top of the role baseline, reproduces the desired full
 * ProjectPermissions. Stored on the access row as JSONB.
 */
export function diffCapabilities(
  role: ProjectRole,
  desired: ProjectPermissions,
): Record<string, boolean> {
  const baseline = resolvePermissions(role, null);
  const delta: Record<string, boolean> = {};
  for (const path of PERMISSION_PATHS) {
    const want = getPermission(desired, path);
    const have = getPermission(baseline, path);
    if (want !== have) {
      delta[path] = want;
    }
  }
  return delta;
}
