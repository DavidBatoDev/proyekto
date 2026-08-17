import { NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EngagementsService } from './engagements.service';

type Row = Record<string, unknown>;

/**
 * In-memory stand-in that actually applies `eq` and `in`. The scoping this
 * service relies on happens in the query, so a fake that ignored filters would
 * make every redaction assertion below vacuous.
 */
function makeSupabase(tables: Record<string, Row[]>): SupabaseClient {
  const from = jest.fn((table: string) => {
    let rows = [...(tables[table] ?? [])];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[column]));
        return builder;
      },
      order: () => builder,
      maybeSingle: () =>
        Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => void) =>
        resolve({ data: rows, error: null }),
    };
    return builder;
  });
  return { from } as unknown as SupabaseClient;
}

const CLIENT = 'user-client';
const CONSULTANT = 'user-consultant';
const TALENT = 'user-talent';
const CLIENT_ENGAGEMENT = 'eng-client';
const TALENT_ENGAGEMENT = 'eng-talent';

/**
 * The canonical two-sided shape: a Client pays a Consultant on one engagement,
 * and that Consultant pays Talent on a separate one.
 */
function fixture(): Record<string, Row[]> {
  return {
    engagements: [
      {
        id: CLIENT_ENGAGEMENT,
        kind: 'client_services',
        scope_mode: 'project_specific',
        status: 'active',
        started_at: '2026-01-01T00:00:00Z',
      },
      {
        id: TALENT_ENGAGEMENT,
        kind: 'talent_services',
        scope_mode: 'flexible',
        status: 'active',
        started_at: '2026-02-01T00:00:00Z',
      },
    ],
    engagement_parties: [
      {
        engagement_id: CLIENT_ENGAGEMENT,
        position: 'hirer',
        user_id: CLIENT,
        capacity: 'client',
        display_name_snapshot: 'Client One',
        email_snapshot: 'client@example.invalid',
      },
      {
        engagement_id: CLIENT_ENGAGEMENT,
        position: 'provider',
        user_id: CONSULTANT,
        capacity: 'consultant',
        display_name_snapshot: 'Consultant One',
        email_snapshot: 'consultant@example.invalid',
      },
      {
        engagement_id: TALENT_ENGAGEMENT,
        position: 'hirer',
        user_id: CONSULTANT,
        capacity: 'consultant',
        display_name_snapshot: 'Consultant One',
        email_snapshot: 'consultant@example.invalid',
      },
      {
        engagement_id: TALENT_ENGAGEMENT,
        position: 'provider',
        user_id: TALENT,
        capacity: 'talent',
        display_name_snapshot: 'Talent One',
        email_snapshot: 'talent@example.invalid',
      },
    ],
    engagement_project_links: [
      {
        id: 'link-1',
        engagement_id: CLIENT_ENGAGEMENT,
        project_id: 'project-1',
        project_title_snapshot: 'Delivery project',
        basis: 'contract_scope',
        status: 'active',
        linked_at: '2026-01-01T00:00:00Z',
        ended_at: null,
      },
    ],
    engagement_time_settings: [
      {
        id: 'settings-current',
        engagement_id: CLIENT_ENGAGEMENT,
        tracking_mode: 'required',
        approval_mode: 'none',
        allow_manual_entries: true,
        rounding_minutes: 15,
        weekly_limit_minutes: null,
        client_hours_detail_level: 'summary',
        effective_from: '2026-01-01',
        effective_until: null,
      },
      {
        id: 'settings-superseded',
        engagement_id: CLIENT_ENGAGEMENT,
        tracking_mode: 'optional',
        approval_mode: 'none',
        allow_manual_entries: true,
        rounding_minutes: 0,
        weekly_limit_minutes: null,
        client_hours_detail_level: 'none',
        effective_from: '2025-01-01',
        effective_until: '2025-12-31',
      },
    ],
    engagement_time_rates: [
      {
        id: 'rate-billing',
        engagement_id: CLIENT_ENGAGEMENT,
        worker_user_id: null,
        rate_kind: 'billing',
        unit: 'hour',
        amount: 100,
        currency: 'USD',
        effective_from: '2026-01-01',
        effective_until: null,
      },
      {
        id: 'rate-billing-old',
        engagement_id: CLIENT_ENGAGEMENT,
        worker_user_id: null,
        rate_kind: 'billing',
        unit: 'hour',
        amount: 80,
        currency: 'USD',
        effective_from: '2025-01-01',
        effective_until: '2025-12-31',
      },
      {
        id: 'rate-cost',
        engagement_id: TALENT_ENGAGEMENT,
        worker_user_id: TALENT,
        rate_kind: 'cost',
        unit: 'hour',
        amount: 40,
        currency: 'USD',
        effective_from: '2026-02-01',
        effective_until: null,
      },
    ],
  };
}

function service(tables = fixture()) {
  return new EngagementsService(makeSupabase(tables));
}

describe('EngagementsService', () => {
  describe('party scoping keeps the two commercial sides apart', () => {
    it('never returns the Talent engagement, identity, or cost rate to the Client', async () => {
      const results = await service().list(CLIENT);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(CLIENT_ENGAGEMENT);

      const serialized = JSON.stringify(results);
      expect(serialized).not.toContain(TALENT_ENGAGEMENT);
      expect(serialized).not.toContain(TALENT);
      expect(serialized).not.toContain('Talent One');
      expect(serialized).not.toContain('cost');
      expect(
        results[0].current_rates.every((rate) => rate.rate_kind === 'billing'),
      ).toBe(true);
    });

    it('refuses a direct fetch of an engagement the caller is not a party to', async () => {
      await expect(
        service().getById(CLIENT, TALENT_ENGAGEMENT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns nothing at all for a user with no seat', async () => {
      expect(await service().list('user-stranger')).toEqual([]);
    });

    it('gives the Consultant both sides, since they hold a seat on each', async () => {
      const results = await service().list(CONSULTANT);

      expect(results.map((view) => view.id).sort()).toEqual(
        [CLIENT_ENGAGEMENT, TALENT_ENGAGEMENT].sort(),
      );
      const talent = results.find((view) => view.id === TALENT_ENGAGEMENT);
      expect(talent?.viewer_position).toBe('hirer');
      expect(talent?.counterparty?.user_id).toBe(TALENT);
    });
  });

  describe('composition', () => {
    it('reports the viewer seat and the opposite party as the counterparty', async () => {
      const [view] = await service().list(CLIENT);

      expect(view.viewer_position).toBe('hirer');
      expect(view.viewer_capacity).toBe('client');
      expect(view.counterparty?.user_id).toBe(CONSULTANT);
      expect(view.counterparty?.position).toBe('provider');
    });

    it('exposes only currently effective settings and rates', async () => {
      const [view] = await service().list(CLIENT);

      expect(view.current_settings?.id).toBe('settings-current');
      expect(view.current_rates.map((rate) => rate.id)).toEqual([
        'rate-billing',
      ]);
    });

    it('attaches project links', async () => {
      const [view] = await service().list(CLIENT);

      expect(view.project_links).toHaveLength(1);
      expect(view.project_links[0].project_id).toBe('project-1');
    });
  });

  describe('filters', () => {
    it('narrows by kind', async () => {
      const results = await service().list(CONSULTANT, {
        kind: 'talent_services',
      });

      expect(results.map((view) => view.id)).toEqual([TALENT_ENGAGEMENT]);
    });

    it('narrows by linked project', async () => {
      const results = await service().list(CONSULTANT, {
        project_id: 'project-1',
      });

      expect(results.map((view) => view.id)).toEqual([CLIENT_ENGAGEMENT]);
    });

    it('returns an empty list when the project matches no engagement', async () => {
      expect(
        await service().list(CONSULTANT, { project_id: 'project-absent' }),
      ).toEqual([]);
    });
  });
});
