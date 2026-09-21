import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type { EngagementListQueryDto } from './dto/engagements.dto';

const ENGAGEMENT_SELECT = `
  id, kind, scope_mode, status, origin, activated_by_contract_id,
  started_at, ended_at, cancelled_at, status_reason, created_at, updated_at
`;

const PARTY_SELECT = `
  engagement_id, position, user_id, capacity,
  display_name_snapshot, email_snapshot
`;

const PROJECT_LINK_SELECT = `
  id, engagement_id, project_id, project_title_snapshot,
  basis, status, linked_at, ended_at
`;

const SETTINGS_SELECT = `
  id, engagement_id, source_contract_id, tracking_mode, approval_mode,
  allow_manual_entries, rounding_minutes, weekly_limit_minutes,
  client_hours_detail_level, effective_from, effective_until
`;

const RATE_SELECT = `
  id, engagement_id, source_contract_id, worker_user_id, rate_kind, unit,
  work_type, amount, currency, effective_from, effective_until
`;

export type EngagementPosition = 'hirer' | 'provider';

export interface EngagementPartyRow {
  engagement_id: string;
  position: EngagementPosition;
  user_id: string;
  capacity: string;
  display_name_snapshot: string | null;
  email_snapshot: string | null;
}

export interface EngagementProjectLinkRow {
  id: string;
  engagement_id: string;
  project_id: string | null;
  project_title_snapshot: string;
  basis: string;
  status: string;
  linked_at: string | null;
  ended_at: string | null;
}

export interface EngagementTimeSettingsRow {
  id: string;
  engagement_id: string;
  source_contract_id: string | null;
  tracking_mode: string;
  approval_mode: string;
  allow_manual_entries: boolean;
  rounding_minutes: number;
  weekly_limit_minutes: number | null;
  client_hours_detail_level: string;
  effective_from: string;
  effective_until: string | null;
}

export interface EngagementTimeRateRow {
  id: string;
  engagement_id: string;
  source_contract_id: string | null;
  worker_user_id: string | null;
  rate_kind: string;
  unit: string;
  work_type: string | null;
  amount: number;
  currency: string | null;
  effective_from: string;
  effective_until: string | null;
}

interface EngagementRow {
  id: string;
  kind: string;
  scope_mode: string;
  status: string;
  origin: string | null;
  activated_by_contract_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  cancelled_at: string | null;
  status_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * One engagement as the requesting party is allowed to see it. The viewer is
 * always a party, so `counterparty` is the other seat and never a third one.
 */
export interface EngagementView extends EngagementRow {
  viewer_position: EngagementPosition;
  viewer_capacity: string;
  counterparty: Omit<EngagementPartyRow, 'engagement_id'> | null;
  project_links: EngagementProjectLinkRow[];
  current_settings: EngagementTimeSettingsRow | null;
  current_rates: EngagementTimeRateRow[];
}

function isEffective(
  row: { effective_from: string; effective_until: string | null },
  today: string,
): boolean {
  if (row.effective_from > today) return false;
  return row.effective_until === null || row.effective_until >= today;
}

/**
 * One contract seat of the caller's, redacted for their capacity. Talent
 * never sees `client_hourly_rate` (the client price is not their commercial
 * business), and no internal cost rate exists on the contract row at all.
 */
export interface AgreementView {
  contract_id: string;
  contract_number: string | null;
  status: string;
  relationship_kind: string;
  my_position: string;
  my_capacity: string;
  counterparty_name: string | null;
  project_id: string | null;
  project_title: string | null;
  currency: string | null;
  signed_at: string | null;
  client_hourly_rate?: number | null;
}

/**
 * Read access to engagements.
 *
 * Authorization is party membership and nothing else: a caller sees an
 * engagement only when they occupy one of its two seats. That single rule is
 * what keeps the two commercial sides apart — a Client is only ever a party on
 * their own `client_services` engagement, so the `talent_services` engagement
 * that carries Talent identity and `cost` rates is never in their result set at
 * all. There is deliberately no "list every engagement on this project" path,
 * because that would have to re-derive the redaction this scoping gives free.
 *
 * These tables have RLS enabled with no policies, so the anon/authenticated
 * clients cannot read them. This service therefore runs on the admin client and
 * owns the filtering itself.
 */
@Injectable()
export class EngagementsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async list(
    callerId: string,
    query: EngagementListQueryDto = {},
  ): Promise<EngagementView[]> {
    const seats = await this.seatsFor(callerId);
    if (seats.size === 0) return [];

    let builder = this.supabase
      .from('engagements')
      .select(ENGAGEMENT_SELECT)
      .in('id', [...seats.keys()]);
    if (query.kind) builder = builder.eq('kind', query.kind);
    if (query.status) builder = builder.eq('status', query.status);

    const { data, error } = await builder.order('started_at', {
      ascending: false,
      nullsFirst: false,
    });
    if (error) throw new Error(error.message);

    const engagements = (data ?? []) as unknown as EngagementRow[];
    const views = await this.compose(engagements, seats);
    if (!query.project_id) return views;
    return views.filter((view) =>
      view.project_links.some((link) => link.project_id === query.project_id),
    );
  }

  async getById(callerId: string, id: string): Promise<EngagementView> {
    const seats = await this.seatsFor(callerId);
    const seat = seats.get(id);
    // Not a party: report the same way as a genuinely missing row so the
    // endpoint cannot be used to probe which engagement ids exist.
    if (!seat) throw new NotFoundException('Engagement not found');

    const { data, error } = await this.supabase
      .from('engagements')
      .select(ENGAGEMENT_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Engagement not found');

    const [view] = await this.compose(
      [data as unknown as EngagementRow],
      seats,
    );
    if (!view) throw new NotFoundException('Engagement not found');
    return view;
  }

  /**
   * Every contract seat the caller occupies, INCLUDING contracts that have no
   * engagement row (legacy/seeded). All statuses are returned — draft/sent
   * simply render as pending states. Redaction mirrors the engagement views:
   * the counterparty contributes only its display-name snapshot, and
   * `client_hourly_rate` (the CLIENT price — no internal cost rate is ever
   * selected) is included only for client/consultant capacities.
   */
  async listAgreements(callerId: string): Promise<AgreementView[]> {
    interface SeatRow {
      contract_id: string;
      position: string;
      capacity: string;
      signed_at: string | null;
      contract: {
        id: string;
        contract_number: string | null;
        status: string;
        relationship_kind: string;
        currency: string | null;
        client_hourly_rate: number | null;
        project_id: string | null;
        project: { id: string; title: string | null } | null;
      } | null;
    }
    const { data, error } = await this.supabase
      .from('contract_positions')
      .select(
        `contract_id, position, capacity, signed_at,
         contract:contracts(id, contract_number, status, relationship_kind,
           currency, client_hourly_rate, project_id,
           project:projects(id, title))`,
      )
      .eq('user_id', callerId);
    if (error) throw new Error(error.message);
    const seats = ((data ?? []) as unknown as SeatRow[]).filter(
      (seat) => seat.contract !== null,
    );
    if (seats.length === 0) return [];

    // The OTHER position's display-name snapshot, per contract.
    const contractIds = [...new Set(seats.map((seat) => seat.contract_id))];
    const { data: siblingData, error: siblingError } = await this.supabase
      .from('contract_positions')
      .select('contract_id, position, user_id, display_name_snapshot')
      .in('contract_id', contractIds);
    if (siblingError) throw new Error(siblingError.message);
    const siblings = (siblingData ?? []) as Array<{
      contract_id: string;
      position: string;
      user_id: string | null;
      display_name_snapshot: string | null;
    }>;

    return seats.map((seat) => {
      const contract = seat.contract as NonNullable<SeatRow['contract']>;
      const counterparty = siblings.find(
        (row) =>
          row.contract_id === seat.contract_id &&
          row.position !== seat.position,
      );
      const view: AgreementView = {
        contract_id: contract.id,
        contract_number: contract.contract_number,
        status: contract.status,
        relationship_kind: contract.relationship_kind,
        my_position: seat.position,
        my_capacity: seat.capacity,
        counterparty_name: counterparty?.display_name_snapshot ?? null,
        project_id: contract.project_id,
        project_title: contract.project?.title ?? null,
        currency: contract.currency,
        signed_at: seat.signed_at,
      };
      // Talent never receives the client price; and internal cost rates were
      // never selected in the first place.
      if (seat.capacity === 'client' || seat.capacity === 'consultant') {
        view.client_hourly_rate = contract.client_hourly_rate;
      }
      return view;
    });
  }

  /** The caller's own seat on each engagement they are a party to. */
  private async seatsFor(
    callerId: string,
  ): Promise<Map<string, EngagementPartyRow>> {
    const { data, error } = await this.supabase
      .from('engagement_parties')
      .select(PARTY_SELECT)
      .eq('user_id', callerId);
    if (error) throw new Error(error.message);

    const seats = new Map<string, EngagementPartyRow>();
    for (const row of (data ?? []) as unknown as EngagementPartyRow[]) {
      seats.set(row.engagement_id, row);
    }
    return seats;
  }

  private async compose(
    engagements: EngagementRow[],
    seats: Map<string, EngagementPartyRow>,
  ): Promise<EngagementView[]> {
    if (engagements.length === 0) return [];
    const ids = engagements.map((engagement) => engagement.id);
    const today = new Date().toISOString().slice(0, 10);

    const [parties, links, settings, rates] = await Promise.all([
      this.fetch<EngagementPartyRow>('engagement_parties', PARTY_SELECT, ids),
      this.fetch<EngagementProjectLinkRow>(
        'engagement_project_links',
        PROJECT_LINK_SELECT,
        ids,
      ),
      this.fetch<EngagementTimeSettingsRow>(
        'engagement_time_settings',
        SETTINGS_SELECT,
        ids,
      ),
      this.fetch<EngagementTimeRateRow>(
        'engagement_time_rates',
        RATE_SELECT,
        ids,
      ),
    ]);

    return engagements.map((engagement) => {
      const seat = seats.get(engagement.id);
      const counterpartyRow = parties.find(
        (party) =>
          party.engagement_id === engagement.id &&
          party.position !== seat?.position,
      );
      return {
        ...engagement,
        viewer_position: seat?.position ?? 'provider',
        viewer_capacity: seat?.capacity ?? '',
        // Built field by field rather than spread so `engagement_id` cannot
        // ride along, and so adding a column to the table never silently
        // widens what a counterparty exposes.
        counterparty: counterpartyRow
          ? {
              position: counterpartyRow.position,
              user_id: counterpartyRow.user_id,
              capacity: counterpartyRow.capacity,
              display_name_snapshot: counterpartyRow.display_name_snapshot,
              email_snapshot: counterpartyRow.email_snapshot,
            }
          : null,
        project_links: links.filter(
          (link) => link.engagement_id === engagement.id,
        ),
        current_settings:
          settings.find(
            (row) =>
              row.engagement_id === engagement.id && isEffective(row, today),
          ) ?? null,
        current_rates: rates.filter(
          (row) =>
            row.engagement_id === engagement.id && isEffective(row, today),
        ),
      };
    });
  }

  private async fetch<T>(
    table: string,
    select: string,
    ids: string[],
  ): Promise<T[]> {
    const { data, error } = await this.supabase
      .from(table)
      .select(select)
      .in('engagement_id', ids);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as T[];
  }
}
