/**
 * Execution's view of the commercial records attached to a project.
 *
 * Contracts and invoices are marketplace concerns, but three execution
 * behaviours legitimately need them: a project may not be deleted while it has
 * live financial records, deleting one should clear its drafts, and the
 * dashboard summarises invoice totals. Previously `ProjectsService` reached
 * straight into the `contracts` and `invoices` tables, which made execution
 * depend on marketplace and meant the execution platform could not run without
 * it.
 *
 * The dependency is inverted through this port: execution declares what it
 * needs, marketplace supplies it. Execution imports nothing from marketplace.
 *
 * Injection is `@Optional()` with the no-op below as the fallback, which is what
 * lets execution boot standalone. `ProjectCommerceModule` in marketplace is
 * `@Global()` and binds the real implementation when it is present.
 *
 * An event bus was considered and rejected: two of these are transactionally
 * meaningful (a veto that must block, and a cascade ordered against
 * `stopRunningLogsForProject`), and fire-and-forget would turn both into a
 * correctness regression dressed up as decoupling.
 */
export const PROJECT_COMMERCE_PORT = Symbol('PROJECT_COMMERCE_PORT');

export interface ProjectInvoiceSummary {
  total_count: number;
  total_amount: number;
  status_counts: Record<string, number>;
}

export interface ProjectCommercePort {
  /**
   * Throw if the project still has commercial records that forbid deletion.
   * Kept separate from the cascade so the veto's failure mode stays
   * unambiguous and its ordering relative to team-time is explicit.
   */
  assertProjectDeletable(projectId: string): Promise<void>;

  /** Remove the draft commercial records a deleted project leaves behind. */
  purgeDraftCommerce(projectId: string): Promise<void>;

  getInvoiceSummary(
    projectIds: string[],
    range: { from?: string; to?: string },
  ): Promise<ProjectInvoiceSummary>;
}

export const EMPTY_INVOICE_SUMMARY: ProjectInvoiceSummary = {
  total_count: 0,
  total_amount: 0,
  status_counts: { draft: 0, issued: 0, sent: 0, paid: 0, void: 0 },
};

/**
 * What execution does when no marketplace is wired up: nothing forbids
 * deletion, there is nothing to purge, and there are no invoices to report.
 */
export class NoopProjectCommerce implements ProjectCommercePort {
  assertProjectDeletable(): Promise<void> {
    return Promise.resolve();
  }

  purgeDraftCommerce(): Promise<void> {
    return Promise.resolve();
  }

  getInvoiceSummary(): Promise<ProjectInvoiceSummary> {
    return Promise.resolve({
      ...EMPTY_INVOICE_SUMMARY,
      status_counts: { ...EMPTY_INVOICE_SUMMARY.status_counts },
    });
  }
}
