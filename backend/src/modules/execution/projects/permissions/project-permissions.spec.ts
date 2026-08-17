import {
  PERMISSION_PATHS,
  resolvePermissions,
  validateDependencies,
} from './project-permissions';

describe('delivery governance gates', () => {
  // Approval authority is a rung on the role ladder, not a fact about who someone
  // is. It used to come from ORIGIN_DELTAS.client — "the client is the acceptor" —
  // which made a project assume it had a client. A member who should accept
  // deliverables is given the rung, or the capability, explicitly.
  it('puts approval authority at admin, not on an identity', () => {
    const admin = resolvePermissions('admin', null);

    expect(admin.access.delivery).toBe(true);
    expect(admin.deliverables.approve).toBe(true);
    expect(admin.change_requests.decide).toBe(true);
  });

  // Raising a change request is asking a question about scope, not editing it —
  // so it sits far lower than deciding one.
  it('lets a commenter raise a change request but not decide it', () => {
    const commenter = resolvePermissions('commenter', null);

    expect(commenter.change_requests.create).toBe(true);
    expect(commenter.change_requests.decide).toBe(false);
    expect(commenter.deliverables.approve).toBe(false);
  });

  it('reads delivery to anyone who can see the project', () => {
    expect(resolvePermissions('viewer', null).access.delivery).toBe(true);
    expect(resolvePermissions('viewer', null).deliverables.edit).toBe(false);
    expect(resolvePermissions('viewer', null).risks.edit).toBe(false);
  });

  // Withholding is still possible — per member, through capabilities, rather than
  // per identity. This is the replacement for the client denials.
  it('withholds internal risks from a specific member via capabilities', () => {
    expect(resolvePermissions('admin', null).risks.view_internal).toBe(true);
    expect(
      resolvePermissions('admin', { 'risks.view_internal': false }).risks
        .view_internal,
    ).toBe(false);
  });

  it('gives an editor edit rights but not approval rights', () => {
    const permissions = resolvePermissions('editor', null);

    expect(permissions.deliverables.edit).toBe(true);
    expect(permissions.risks.edit).toBe(true);
    expect(permissions.deliverables.approve).toBe(false);
    expect(permissions.change_requests.decide).toBe(false);
  });

  it('declares every new path in PERMISSION_PATHS', () => {
    for (const path of [
      'access.delivery',
      'deliverables.edit',
      'deliverables.approve',
      'change_requests.create',
      'change_requests.decide',
      'risks.edit',
      'risks.view_internal',
    ] as const) {
      expect(PERMISSION_PATHS).toContain(path);
    }
  });

  it.each(['viewer', 'commenter', 'editor', 'admin', 'owner'] as const)(
    'resolves a dependency-consistent set for %s',
    (role) => {
      expect(validateDependencies(resolvePermissions(role, null))).toEqual({
        ok: true,
      });
    },
  );
});

describe('capability overrides', () => {
  it('applies capabilities as the final layer, over the role baseline', () => {
    // Grant above the rung...
    expect(
      resolvePermissions('editor', { 'deliverables.approve': true })
        .deliverables.approve,
    ).toBe(true);
    // ...and deny below it. Denial is what makes per-member withholding possible
    // without reintroducing an identity rule.
    expect(
      resolvePermissions('admin', { 'time.view_team_logs': false }).time
        .view_team_logs,
    ).toBe(false);
  });

  it('ignores non-boolean capability values rather than coercing them', () => {
    const permissions = resolvePermissions('viewer', {
      'deliverables.approve': 'yes',
      'risks.edit': 1,
    } as unknown as Record<string, unknown>);

    expect(permissions.deliverables.approve).toBe(false);
    expect(permissions.risks.edit).toBe(false);
  });

  it('ignores unknown capability keys', () => {
    // Stored rows may still carry retired paths — notably the three
    // chat.message_clients / _consultants / _freelancers keys deleted with the
    // persona model. An unknown key must not throw or leak into the result.
    expect(() =>
      resolvePermissions('viewer', {
        'chat.message_clients': true,
        'nonsense.path': true,
      }),
    ).not.toThrow();

    expect(
      Object.keys(
        resolvePermissions('viewer', { 'chat.message_clients': true }).chat,
      ),
    ).not.toContain('message_clients');
  });
});
