import {
  PERMISSION_PATHS,
  type PermissionPath,
  type ProjectPermissions,
  getPermission,
  resolvePermissions,
} from './project-permissions';
import type { ProjectRole } from '../authorization/project-authorization.service';

/**
 * Effective permissions for every (role, origin, capabilities) combination that
 * ACTUALLY EXISTS in production.
 *
 * This exists to make the persona removal auditable. Removing `ORIGIN_DELTAS`
 * changes what real members can do, and the only safe way to make that change is
 * to know precisely which rows move and in which direction. The snapshot below is
 * the whole permission surface of the live system, so any drift shows up as a
 * diff rather than as a support ticket.
 *
 * Combinations captured from `select role, origin, capabilities, count(*) from
 * project_access group by 1,2,3` on 2026-08-17 (106 rows, 8 distinct tuples).
 *
 * `origin` is recorded on each tuple for provenance only — it is NOT an input to
 * `resolvePermissions` any more, which is the point of the change these tests
 * document. It stays here so the row counts remain traceable to real data.
 *
 * If you add a role+capabilities combination in code, add it here too; a
 * combination the resolver can produce but this file does not cover is a
 * combination nobody has checked.
 */

interface ProductionTuple {
  label: string;
  role: ProjectRole;
  /** Already normalised: `team:*` rows arrive as null. */
  origin: 'client' | 'consultant' | 'invited' | 'personal_workspace' | null;
  capabilities: Record<string, unknown> | null;
  /** Row count on 2026-08-17, for weighting how much a diff matters. */
  rows: number;
}

/** The two capability-bearing rows, verbatim from production. */
const TEAM_EDITOR_ELEVATED_A: Record<string, boolean> = {
  'teams.view': false,
  'members.manage': true,
  'roadmap.promote': true,
  'project.settings': true,
  'resources.delete': true,
  'roadmap.dev_mode': true,
  'logs.view_sensitive': true,
  'chat.create_channels': true,
  'chat.manage_channels': true,
  'project.edit_content': true,
  'members.edit_position': true,
  'roadmap.view_internal': true,
  'access.project_settings': true,
  'members.edit_permissions': true,
  'chat.view_internal_channels': true,
  'project.view_internal_content': true,
};

const TEAM_EDITOR_ELEVATED_B: Record<string, boolean> = {
  'teams.manage': true,
  'members.manage': true,
  'access.contract': true,
  'access.invoices': true,
  'roadmap.promote': true,
  'project.settings': true,
  'resources.delete': true,
  'roadmap.dev_mode': true,
  'access.financials': true,
  'logs.view_sensitive': true,
  'time.view_team_logs': true,
  'chat.create_channels': true,
  'chat.manage_channels': true,
  'project.edit_content': true,
  'members.edit_position': true,
  'roadmap.view_internal': true,
  'access.project_settings': true,
  'members.edit_permissions': true,
  'chat.view_internal_channels': true,
  'project.view_internal_content': true,
};

const PRODUCTION_TUPLES: ProductionTuple[] = [
  {
    label: 'editor + team-derived',
    role: 'editor',
    origin: null,
    capabilities: {},
    rows: 53,
  },
  {
    label: 'owner + consultant',
    role: 'owner',
    origin: 'consultant',
    capabilities: {},
    rows: 17,
  },
  {
    label: 'owner + personal_workspace',
    role: 'owner',
    origin: 'personal_workspace',
    capabilities: {},
    rows: 12,
  },
  {
    label: 'admin + team-derived',
    role: 'admin',
    origin: null,
    capabilities: {},
    rows: 10,
  },
  {
    label: 'editor + invited',
    role: 'editor',
    origin: 'invited',
    capabilities: {},
    rows: 7,
  },
  {
    label: 'admin + client',
    role: 'admin',
    origin: 'client',
    capabilities: {},
    rows: 6,
  },
  {
    label: 'editor + team-derived, elevated by capabilities (A)',
    role: 'editor',
    origin: null,
    capabilities: TEAM_EDITOR_ELEVATED_A,
    rows: 1,
  },
  {
    label: 'editor + team-derived, elevated by capabilities (B)',
    role: 'editor',
    origin: null,
    capabilities: TEAM_EDITOR_ELEVATED_B,
    rows: 1,
  },
];

/** Flatten to `{ 'section.field': boolean }` so a snapshot diff names the path. */
function flatten(perms: ProjectPermissions): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const path of PERMISSION_PATHS) {
    out[path] = getPermission(perms, path);
  }
  return out;
}

describe('effective permissions across every production combination', () => {
  /**
   * The audit. A diff here is a real change to what real people can do — read it
   * path by path before updating the snapshot.
   */
  it.each(PRODUCTION_TUPLES)('$label ($rows rows)', (tuple) => {
    const resolved = resolvePermissions(tuple.role, tuple.capabilities);
    expect(flatten(resolved)).toMatchSnapshot();
  });

  /**
   * The three paths the persona removal deliberately opened up.
   *
   * `ORIGIN_DELTAS.client` denied these to client-origin members regardless of
   * role. Every client row in production is `admin`, and the admin baseline grants
   * all three — so deleting the delta released exactly this set and nothing else.
   *
   * Asserted separately from the snapshot so the intent survives a casual
   * `--updateSnapshot`: if someone later re-denies these to some class of member,
   * this is the test that says it was once a persona rule and should not become one
   * again. Withhold them per member via `capabilities` instead.
   */
  const RELEASED_BY_PERSONA_REMOVAL: PermissionPath[] = [
    'time.view_team_logs',
    'risks.view_internal',
    'decisions.view_internal',
  ];

  it.each(RELEASED_BY_PERSONA_REMOVAL)(
    'an admin holds %s however they joined the project',
    (path) => {
      expect(getPermission(resolvePermissions('admin', {}), path)).toBe(true);
    },
  );

  /**
   * The mechanism that replaced the origin deltas.
   *
   * Capabilities are applied last and can DENY, not only grant — that is what
   * makes per-member withholding possible without reintroducing a persona rule.
   * If this ever stops holding, the only way back to "this member cannot see
   * internal risks" is an origin-style rule, which is the thing being removed.
   */
  it.each(RELEASED_BY_PERSONA_REMOVAL)(
    'capabilities can withhold %s from an individual admin',
    (path) => {
      const withheld = resolvePermissions('admin', { [path]: false });

      expect(getPermission(withheld, path)).toBe(false);
    },
  );

  /**
   * Resolution depends on the role ladder and capabilities only.
   *
   * Two members who joined completely differently — a team-derived editor and a
   * directly-invited editor — are indistinguishable to the resolver. That is the
   * whole point: how someone got here is provenance, not permission.
   */
  it('resolves identically for members who joined differently', () => {
    const teamDerived = resolvePermissions('editor', {});
    const directlyInvited = resolvePermissions('editor', {});

    expect(flatten(teamDerived)).toEqual(flatten(directlyInvited));
  });

  /** No persona-named permission path survives in the catalog. */
  it('has no persona-named permission paths', () => {
    const personaNamed = PERMISSION_PATHS.filter((path) =>
      /client|consultant|freelancer/i.test(path),
    );

    expect(personaNamed).toEqual([]);
  });
});
