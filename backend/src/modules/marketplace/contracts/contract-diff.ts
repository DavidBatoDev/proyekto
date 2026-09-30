/**
 * The deterministic comparison of two contract versions.
 *
 * Everything the History and Compare views show comes from here, computed
 * without AI. The AI change summary (contract-change-summary.service.ts) only
 * ever EXPLAINS rows this module produced: its input is the rows, and a bullet
 * that cites no row is dropped. So nothing the model says can introduce a
 * change that is not in this diff.
 */

import type {
  ContractClause,
  ContractService,
} from './contract-clause-template';

/** The shape a version is compared in, and what `contracts.signed_terms` stores. */
export interface ContractTermsSnapshot {
  schema: 1;
  version: number;
  revision: number;
  document_title: string | null;
  fields: Record<string, unknown>;
  clauses: Array<
    Pick<ContractClause, 'key' | 'title' | 'body'> & {
      parent_key?: string | null;
      position: number;
    }
  >;
  services: Array<
    Pick<ContractService, 'id' | 'name' | 'unit_rate'> & {
      description?: string | null;
      unit?: string | null;
    }
  >;
}

/** One changed term. `id` is what an AI bullet must cite. */
export interface FieldDiffRow {
  id: string;
  kind: 'field';
  field: string;
  label: string;
  before: unknown;
  after: unknown;
}

export interface ClauseDiffRow {
  id: string;
  kind: 'clause';
  key: string;
  title: string;
  change: 'added' | 'removed' | 'changed';
  before: string | null;
  after: string | null;
}

export interface ServiceDiffRow {
  id: string;
  kind: 'service';
  service_id: string;
  name: string;
  change: 'added' | 'removed' | 'changed';
  before: { name: string; unit_rate: number; unit?: string | null } | null;
  after: { name: string; unit_rate: number; unit?: string | null } | null;
}

export type DiffRow = FieldDiffRow | ClauseDiffRow | ServiceDiffRow;

export interface ContractDiff {
  fields: FieldDiffRow[];
  clauses: ClauseDiffRow[];
  services: ServiceDiffRow[];
}

/** The seat the diff is computed for. `viewer` is a non-party finance reader. */
export type DiffSeat = 'hirer' | 'provider' | 'viewer';

/**
 * Every term a version is compared on, in reading order, with the label the
 * Compare table shows. Anything not listed is bookkeeping (ids, timestamps,
 * signatures) and never appears in a diff.
 */
export const TERM_FIELDS: ReadonlyArray<{ field: string; label: string }> = [
  { field: 'document_title', label: 'Agreement title' },
  { field: 'provider_kind', label: 'Provider type' },
  { field: 'provider_name', label: 'Provider name' },
  { field: 'provider_address', label: 'Provider address' },
  { field: 'provider_tin', label: 'Provider tax ID' },
  { field: 'provider_email', label: 'Provider email' },
  { field: 'client_kind', label: 'Client type' },
  { field: 'client_name', label: 'Client name' },
  { field: 'client_contact_name', label: 'Client contact' },
  { field: 'client_address', label: 'Client address' },
  { field: 'client_tin', label: 'Client tax ID' },
  { field: 'client_email', label: 'Client email' },
  { field: 'currency', label: 'Currency' },
  { field: 'billing_mode', label: 'Billing mode' },
  { field: 'billing_timing', label: 'Billing timing' },
  { field: 'fixed_fee', label: 'Fixed fee' },
  { field: 'recurring_fee', label: 'Monthly rate' },
  { field: 'client_hourly_rate', label: 'Hourly rate' },
  { field: 'included_hours', label: 'Included hours' },
  { field: 'invoice_cadence', label: 'Invoice cadence' },
  { field: 'invoice_offset_days', label: 'Invoice offset (days)' },
  { field: 'due_days', label: 'Payment due (days)' },
  { field: 'payment_method', label: 'Payment method' },
  { field: 'service_description', label: 'Service description' },
  { field: 'service_start_date', label: 'Service start' },
  { field: 'term_count', label: 'Term length' },
  { field: 'term_unit', label: 'Term unit' },
  { field: 'service_end_date', label: 'Service end' },
  { field: 'auto_renew', label: 'Auto-renew' },
  { field: 'notice_days', label: 'Notice period (days)' },
  { field: 'amendment_effective_date', label: 'Effective from' },
  { field: 'time_tracking_mode', label: 'Time tracking' },
  { field: 'time_approval_mode', label: 'Time approval' },
  { field: 'allow_manual_time', label: 'Manual time entries' },
  { field: 'time_rounding_minutes', label: 'Time rounding (minutes)' },
  { field: 'weekly_time_limit_minutes', label: 'Weekly time limit (minutes)' },
  { field: 'client_hours_detail_level', label: 'Client hours detail' },
  { field: 'notes', label: 'Internal notes' },
];

/**
 * Fields only the consultant's side may see in a diff. `notes` is the
 * consultant's working note on the agreement and never printed on it, so a
 * counterparty's diff (and therefore their AI summary input) never carries it.
 */
export const CONSULTANT_ONLY_FIELDS: ReadonlySet<string> = new Set(['notes']);

function normalize(value: unknown): unknown {
  if (value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed))
      return Number(trimmed);
    return trimmed;
  }
  return value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** The comparable projection of a contract row. */
export function contractTermsSnapshot(row: {
  version: number;
  revision: number;
  document_title?: string | null;
  clauses?: ContractClause[] | null;
  services?: ContractService[] | null;
  [key: string]: unknown;
}): ContractTermsSnapshot {
  const fields: Record<string, unknown> = {};
  for (const { field } of TERM_FIELDS) fields[field] = normalize(row[field]);
  return {
    schema: 1,
    version: row.version,
    revision: row.revision,
    document_title: row.document_title ?? null,
    fields,
    clauses: [...(row.clauses ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((clause, index) => ({
        key: clause.key,
        parent_key: clause.parent_key ?? null,
        title: clause.title,
        body: clause.body,
        position: index,
      })),
    services: [...(row.services ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description ?? null,
        unit: service.unit ?? null,
        unit_rate: Number(service.unit_rate),
      })),
  };
}

/**
 * Field, clause and service rows that differ between two versions.
 *
 * `seat` is the viewer's side of the agreement. A consultant-only field is
 * included only when the viewer IS the consultant's seat; callers pass
 * `consultantSeat` so this module never has to know the relationship kind.
 */
export function diffContractTerms(
  from: ContractTermsSnapshot,
  to: ContractTermsSnapshot,
  options: { seat: DiffSeat; consultantSeat: 'hirer' | 'provider' | null },
): ContractDiff {
  const seesConsultantOnly =
    options.seat !== 'viewer' && options.seat === options.consultantSeat;

  const fields: FieldDiffRow[] = [];
  for (const { field, label } of TERM_FIELDS) {
    if (CONSULTANT_ONLY_FIELDS.has(field) && !seesConsultantOnly) continue;
    const before = from.fields[field] ?? null;
    const after = to.fields[field] ?? null;
    if (!same(before, after)) {
      fields.push({
        id: `field:${field}`,
        kind: 'field',
        field,
        label,
        before,
        after,
      });
    }
  }

  const clauses: ClauseDiffRow[] = [];
  const fromClauses = new Map(from.clauses.map((c) => [c.key, c]));
  const toClauses = new Map(to.clauses.map((c) => [c.key, c]));
  for (const clause of to.clauses) {
    const previous = fromClauses.get(clause.key);
    if (!previous) {
      clauses.push({
        id: `clause:${clause.key}`,
        kind: 'clause',
        key: clause.key,
        title: clause.title,
        change: 'added',
        before: null,
        after: clause.body,
      });
    } else if (
      previous.body !== clause.body ||
      previous.title !== clause.title
    ) {
      clauses.push({
        id: `clause:${clause.key}`,
        kind: 'clause',
        key: clause.key,
        title: clause.title,
        change: 'changed',
        before: previous.body,
        after: clause.body,
      });
    }
  }
  for (const clause of from.clauses) {
    if (!toClauses.has(clause.key)) {
      clauses.push({
        id: `clause:${clause.key}`,
        kind: 'clause',
        key: clause.key,
        title: clause.title,
        change: 'removed',
        before: clause.body,
        after: null,
      });
    }
  }

  const services: ServiceDiffRow[] = [];
  const fromServices = new Map(from.services.map((s) => [s.id, s]));
  const toServices = new Map(to.services.map((s) => [s.id, s]));
  const pick = (s: ContractTermsSnapshot['services'][number]) => ({
    name: s.name,
    unit_rate: s.unit_rate,
    unit: s.unit ?? null,
  });
  for (const service of to.services) {
    const previous = fromServices.get(service.id);
    if (!previous) {
      services.push({
        id: `service:${service.id}`,
        kind: 'service',
        service_id: service.id,
        name: service.name,
        change: 'added',
        before: null,
        after: pick(service),
      });
    } else if (!same(pick(previous), pick(service))) {
      services.push({
        id: `service:${service.id}`,
        kind: 'service',
        service_id: service.id,
        name: service.name,
        change: 'changed',
        before: pick(previous),
        after: pick(service),
      });
    }
  }
  for (const service of from.services) {
    if (!toServices.has(service.id)) {
      services.push({
        id: `service:${service.id}`,
        kind: 'service',
        service_id: service.id,
        name: service.name,
        change: 'removed',
        before: pick(service),
        after: null,
      });
    }
  }

  return { fields, clauses, services };
}

/** Every row of a diff, flat, in display order. */
export function diffRows(diff: ContractDiff): DiffRow[] {
  return [...diff.fields, ...diff.services, ...diff.clauses];
}

/**
 * The revision-level diff stored in contract_revisions.changes, filtered to
 * term fields and to what this seat may see. Used by the "Changed since you
 * last viewed" panel.
 */
export function visibleRevisionChanges(
  changes: Record<string, { before: unknown; after: unknown }>,
  options: { seat: DiffSeat; consultantSeat: 'hirer' | 'provider' | null },
): Array<{ field: string; label: string; before: unknown; after: unknown }> {
  const seesConsultantOnly =
    options.seat !== 'viewer' && options.seat === options.consultantSeat;
  const labels = new Map(TERM_FIELDS.map((f) => [f.field, f.label]));
  labels.set('clauses', 'Agreement clauses');
  labels.set('services', 'Services');
  return Object.entries(changes)
    .filter(([field]) => labels.has(field))
    .filter(
      ([field]) => seesConsultantOnly || !CONSULTANT_ONLY_FIELDS.has(field),
    )
    .map(([field, change]) => ({
      field,
      label: labels.get(field) ?? field,
      before: change.before,
      after: change.after,
    }));
}
