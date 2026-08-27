/**
 * Finance-book roles resolved to capability sets.
 *
 * The book-scoped sibling of `project-permissions.ts`: a pure
 * `(role, overrides) -> capabilities` function with no I/O, so it can be
 * snapshot-tested and mirrored on the web without drift. These capabilities
 * govern ONLY finance-book surfaces — a book member with every capability
 * still has zero execution access, because books never write `project_access`.
 *
 * Because every finance service runs on the service-role client, whatever
 * `resolveBookPermissions` says IS the security boundary for book surfaces.
 */

export type FinanceBookRole =
  | 'owner'
  | 'manager'
  | 'accountant'
  | 'viewer_client'
  | 'viewer';

export interface FinanceBookPermissions {
  /** See the book at all (every role has this). */
  view: boolean;
  /** Time logs and payout records. */
  view_time: boolean;
  /** Internal cost rates and rate_snapshot-derived figures. NEVER for clients. */
  view_costs: boolean;
  /** Contracts and invoices. */
  view_contracts: boolean;
  /** Download .csv/.xlsx/.pdf exports (columns still filtered by view_costs). */
  export: boolean;
  /** Manage member rates, payouts, and cost allocations (the HR tier). */
  manage_money: boolean;
  /** Add/remove members and send invites. */
  manage_members: boolean;
  /** Create/archive child books, rename, change settings. */
  manage_book: boolean;
}

export const FINANCE_BOOK_CAPABILITY_PATHS = [
  'view',
  'view_time',
  'view_costs',
  'view_contracts',
  'export',
  'manage_money',
  'manage_members',
  'manage_book',
] as const satisfies ReadonlyArray<keyof FinanceBookPermissions>;

const ROLE_DEFAULTS: Record<FinanceBookRole, FinanceBookPermissions> = {
  owner: {
    view: true,
    view_time: true,
    view_costs: true,
    view_contracts: true,
    export: true,
    manage_money: true,
    manage_members: true,
    manage_book: true,
  },
  // The HR tier: money and time administration, inherited from F2 onto F3s.
  manager: {
    view: true,
    view_time: true,
    view_costs: true,
    view_contracts: true,
    export: true,
    manage_money: true,
    manage_members: false,
    manage_book: false,
  },
  // View + export of time logs and payouts only — never creates or edits.
  accountant: {
    view: true,
    view_time: true,
    view_costs: false,
    view_contracts: false,
    export: true,
    manage_money: false,
    manage_members: false,
    manage_book: false,
  },
  // The client seat: their contracts and invoices, nothing that could carry
  // an internal cost figure.
  viewer_client: {
    view: true,
    view_time: false,
    view_costs: false,
    view_contracts: true,
    export: false,
    manage_money: false,
    manage_members: false,
    manage_book: false,
  },
  viewer: {
    view: true,
    view_time: true,
    view_costs: false,
    view_contracts: false,
    export: false,
    manage_money: false,
    manage_members: false,
    manage_book: false,
  },
};

/**
 * Overrides may grant or deny any capability except `view` (a member who
 * cannot view is not a member — remove the row instead) and may never grant
 * `view_costs` to `viewer_client` (the client-never-sees-cost invariant, the
 * book-side twin of `assertNoInternalRates`).
 */
export function resolveBookPermissions(
  role: FinanceBookRole,
  overrides?: Record<string, unknown> | null,
): FinanceBookPermissions {
  const resolved = { ...ROLE_DEFAULTS[role] };
  if (overrides) {
    for (const path of FINANCE_BOOK_CAPABILITY_PATHS) {
      if (path === 'view') continue;
      const value = overrides[path];
      if (typeof value === 'boolean') resolved[path] = value;
    }
  }
  if (role === 'viewer_client') resolved.view_costs = false;
  return resolved;
}
