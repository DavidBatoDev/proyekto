import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ContractChangeSummaryService,
  groundSummary,
  summaryInput,
} from './contract-change-summary.service';
import {
  contractTermsSnapshot,
  diffContractTerms,
  diffRows,
} from './contract-diff';
import {
  ContractSnapshotService,
  sha256Hex,
} from './contract-snapshot.service';
import { contractFixture } from './contracts.service.test-fixtures';

const snap = (overrides: Parameters<typeof contractFixture>[0] = {}) =>
  contractTermsSnapshot(
    contractFixture(overrides) as unknown as Parameters<
      typeof contractTermsSnapshot
    >[0],
  );

describe('contract diff', () => {
  it('lists changed fields, services and clauses and nothing else', () => {
    const from = snap({
      recurring_fee: 80,
      clauses: [
        {
          key: 'termination',
          title: 'Termination',
          body: '60 days',
          position: 0,
        },
        { key: 'old', title: 'Old', body: 'gone', position: 1 },
      ],
      services: [{ id: 's1', name: 'Build', unit_rate: 10, position: 0 }],
    });
    const to = snap({
      recurring_fee: '95' as unknown as number,
      version: 2,
      clauses: [
        {
          key: 'termination',
          title: 'Termination',
          body: '30 days',
          position: 0,
        },
        { key: 'new', title: 'New', body: 'hello', position: 1 },
      ],
      services: [{ id: 's1', name: 'Build', unit_rate: 12, position: 0 }],
    });

    const diff = diffContractTerms(from, to, {
      seat: 'hirer',
      consultantSeat: 'provider',
    });

    expect(diff.fields.map((row) => row.id)).toEqual(['field:recurring_fee']);
    expect(diff.fields[0]).toEqual(
      expect.objectContaining({ before: 80, after: 95 }),
    );
    expect(diff.services).toEqual([
      expect.objectContaining({ id: 'service:s1', change: 'changed' }),
    ]);
    expect(diff.clauses.map((row) => [row.id, row.change]).sort()).toEqual([
      ['clause:new', 'added'],
      ['clause:old', 'removed'],
      ['clause:termination', 'changed'],
    ]);
  });

  it('never gives a client seat the consultant-only fields', () => {
    const from = snap({ notes: 'margin is thin' });
    const to = snap({ notes: 'margin is fine', recurring_fee: 2000 });

    const clientDiff = diffContractTerms(from, to, {
      seat: 'hirer',
      consultantSeat: 'provider',
    });
    const consultantDiff = diffContractTerms(from, to, {
      seat: 'provider',
      consultantSeat: 'provider',
    });

    expect(clientDiff.fields.map((row) => row.field)).toEqual([
      'recurring_fee',
    ]);
    expect(consultantDiff.fields.map((row) => row.field)).toContain('notes');

    // And therefore neither does the AI summary input built from it.
    const input = summaryInput(clientDiff, {
      seat: 'hirer',
      seatLabel: 'Client',
      fromVersion: 1,
      toVersion: 2,
      effectiveFrom: null,
      documentTitle: 'Service Agreement',
    });
    expect(JSON.stringify(input)).not.toContain('margin');
    expect(JSON.stringify(input)).not.toContain('notes');
  });
});

describe('AI change summary grounding', () => {
  const diff = diffContractTerms(
    snap({ recurring_fee: 1 }),
    snap({ recurring_fee: 2 }),
    {
      seat: 'hirer',
      consultantSeat: 'provider',
    },
  );
  const rows = diffRows(diff);

  it('drops a bullet that cites no real diff row', () => {
    const grounded = groundSummary(
      {
        headline: 'Changes',
        bullets: [
          {
            text: 'The monthly rate doubles.',
            row_ids: ['field:recurring_fee'],
          },
          { text: 'Notice drops to 30 days.', row_ids: ['field:notice_days'] },
          { text: 'Uncited claim.', row_ids: [] },
        ],
        for_you: 'You pay more.',
      },
      rows,
    );
    expect(grounded.bullets).toEqual([
      { text: 'The monthly rate doubles.', row_ids: ['field:recurring_fee'] },
    ]);
  });

  it('serves a cached summary without calling the agent', async () => {
    const agent = { post: jest.fn() };
    const cached = {
      summary: { headline: 'h', bullets: [], for_you: null },
      model: 'gpt-5.6-luna',
      created_at: '2026-09-30T00:00:00Z',
    };
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) builder[m] = jest.fn(() => builder);
    builder.maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: cached, error: null });
    const supabase = {
      from: jest.fn(() => builder),
    } as unknown as SupabaseClient;
    const service = new ContractChangeSummaryService(supabase, agent as never);

    const result = await service.summarize({
      callerId: 'u',
      from: { id: 'a', version: 1, revision: 1 },
      to: {
        id: 'b',
        version: 2,
        revision: 1,
        amendment_effective_date: null,
        document_title: 'Service Agreement',
      },
      seat: 'hirer',
      seatLabel: 'Client',
      diff,
    });

    expect(agent.post).not.toHaveBeenCalled();
    expect(result.cached).toBe(true);
  });

  it('grounds and caches a fresh summary from the agent', async () => {
    const agent = {
      post: jest.fn().mockResolvedValue({
        headline: 'Rate change',
        bullets: [
          { text: 'Rate rises.', row_ids: ['field:recurring_fee'] },
          { text: 'Invented.', row_ids: ['field:nope'] },
        ],
        for_you: 'Pay more.',
        model: 'gpt-5.6-luna',
      }),
    };
    const inserted: unknown[] = [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) builder[m] = jest.fn(() => builder);
    builder.maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: null, error: null });
    builder.insert = jest.fn((row: unknown) => {
      inserted.push(row);
      return Promise.resolve({ error: null });
    });
    const supabase = {
      from: jest.fn(() => builder),
    } as unknown as SupabaseClient;
    const service = new ContractChangeSummaryService(supabase, agent as never);

    const result = await service.summarize({
      callerId: 'u',
      from: { id: 'a', version: 1, revision: 1 },
      to: {
        id: 'b',
        version: 2,
        revision: 3,
        amendment_effective_date: '2026-10-01',
        document_title: 'Service Agreement',
      },
      seat: 'hirer',
      seatLabel: 'Client',
      diff,
    });

    expect(agent.post).toHaveBeenCalledWith(
      '/contracts/summarize-changes',
      expect.objectContaining({ seat: 'hirer', rows: expect.any(Array) }),
      expect.any(Object),
    );
    expect(result.bullets).toHaveLength(1);
    expect(inserted[0]).toEqual(
      expect.objectContaining({
        from_revision: 1,
        to_revision: 3,
        seat: 'hirer',
      }),
    );
  });
});

describe('freeze on signing', () => {
  it('stores the rendered PDF once and the stored hash matches the bytes served', async () => {
    const stored = new Map<string, Buffer>();
    const uploads = {
      putPrivateObject: jest.fn((key: string, body: Buffer) => {
        stored.set(key, body);
        return Promise.resolve({ path: key });
      }),
      getPrivateObject: jest.fn((key: string) =>
        Promise.resolve(stored.get(key) as Buffer),
      ),
    };
    let update: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    for (const m of ['eq', 'is', 'select']) builder[m] = jest.fn(() => builder);
    builder.update = jest.fn((patch: Record<string, unknown>) => {
      update = patch;
      return builder;
    });
    const contract = contractFixture({
      status: 'signed',
      signed_by_client_at: '2026-09-01T00:00:00Z',
      signed_by_client_name: 'Client One',
      signed_by_consultant_at: '2026-09-01T00:00:00Z',
      signed_by_consultant_name: 'Consultant One',
      clauses: [
        {
          key: 'parties',
          title: 'Parties',
          body: 'Between {{client}} and {{provider}}.',
          position: 0,
        },
      ],
    });
    builder.maybeSingle = jest.fn(() =>
      Promise.resolve({ data: { ...contract, ...update }, error: null }),
    );
    const supabase = {
      from: jest.fn(() => builder),
    } as unknown as SupabaseClient;
    const service = new ContractSnapshotService(supabase, uploads as never);

    const frozen = await service.freeze(contract, [], 'at_signing');

    expect(frozen?.signed_pdf_path).toMatch(
      /^contract_snapshots\/contract-1\//,
    );
    expect(update.signed_snapshot_kind).toBe('at_signing');
    expect(update.signed_terms).toEqual(
      expect.objectContaining({ schema: 1, version: 1 }),
    );
    // Guarded so a racing second freeze never overwrites the first.
    expect(builder.is).toHaveBeenCalledWith('signed_pdf_path', null);

    const served = await service.readFrozen(frozen!);
    expect(served?.verified).toBe(true);
    expect(served?.sha256).toBe(
      sha256Hex(stored.values().next().value as Buffer),
    );
    expect(served?.sha256).toBe(update.signed_pdf_sha256);
  });

  it('reports a tampered file as unverified', async () => {
    const uploads = {
      getPrivateObject: jest.fn().mockResolvedValue(Buffer.from('changed')),
    };
    const service = new ContractSnapshotService({} as never, uploads as never);
    const result = await service.readFrozen(
      contractFixture({
        signed_pdf_path: 'k',
        signed_pdf_sha256: sha256Hex(Buffer.from('original')),
      }),
    );
    expect(result?.verified).toBe(false);
  });

  it('does not freeze an unsigned contract', async () => {
    const service = new ContractSnapshotService({} as never, {} as never);
    await expect(
      service.freeze(contractFixture({ status: 'sent' }), [], 'at_signing'),
    ).resolves.toBeNull();
  });
});
