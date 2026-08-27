import {
  FINANCE_BOOK_CAPABILITY_PATHS,
  type FinanceBookRole,
  resolveBookPermissions,
} from './finance-book-permissions';

const ROLES: FinanceBookRole[] = [
  'owner',
  'manager',
  'accountant',
  'viewer_client',
  'viewer',
];

describe('resolveBookPermissions', () => {
  it('matches the role-default matrix', () => {
    const matrix = Object.fromEntries(
      ROLES.map((role) => [role, resolveBookPermissions(role)]),
    );
    expect(matrix).toMatchSnapshot();
  });

  it('applies boolean overrides except view', () => {
    const resolved = resolveBookPermissions('accountant', {
      view_costs: true,
      export: false,
      view: false, // ignored — a member who cannot view is not a member
    });
    expect(resolved.view).toBe(true);
    expect(resolved.view_costs).toBe(true);
    expect(resolved.export).toBe(false);
  });

  it('never grants view_costs to viewer_client, even by override', () => {
    const resolved = resolveBookPermissions('viewer_client', {
      view_costs: true,
    });
    expect(resolved.view_costs).toBe(false);
  });

  it('ignores non-boolean override values', () => {
    const resolved = resolveBookPermissions('viewer', {
      manage_money: 'yes',
      export: 1,
    });
    expect(resolved.manage_money).toBe(false);
    expect(resolved.export).toBe(false);
  });

  it('every capability path exists on every role result', () => {
    for (const role of ROLES) {
      const resolved = resolveBookPermissions(role);
      for (const path of FINANCE_BOOK_CAPABILITY_PATHS) {
        expect(typeof resolved[path]).toBe('boolean');
      }
    }
  });
});
