import type { SupabaseClient } from '@supabase/supabase-js';
import { ContractPageInitialsService } from './contract-page-initials.service';

function harness(contractStatus = 'sent') {
  let upserted: Array<Record<string, unknown>> = [];
  const initialsTable = {
    upsert: jest.fn((rows: Array<Record<string, unknown>>) => {
      upserted = rows;
      return { select: () => Promise.resolve({ data: rows, error: null }) };
    }),
    select: jest.fn(() => ({
      eq: () => ({
        order: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
      }),
    })),
    delete: jest.fn(() => ({
      eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
    })),
  };
  const contractsTable = {
    select: jest.fn(() => ({
      eq: () => ({
        maybeSingle: () =>
          Promise.resolve({
            data: { id: 'contract-1', status: contractStatus },
            error: null,
          }),
      }),
    })),
  };
  const supabase = {
    from: jest.fn((table: string) =>
      table === 'contracts' ? contractsTable : initialsTable,
    ),
  } as unknown as SupabaseClient;
  const uploads = {
    uploadFile: jest
      .fn()
      .mockResolvedValue({ publicUrl: 'https://cdn.test/initials.png' }),
  };
  const service = new ContractPageInitialsService(supabase, uploads as never);
  return { service, uploads, upserted: () => upserted };
}

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('ContractPageInitialsService', () => {
  it('stamps one act across every page in a single write', async () => {
    const { service, upserted } = harness();

    await service.save('contract-1', 'user-1', {
      position: 'provider',
      method: 'typed',
      initials_text: 'JCG',
      pages: [0, 1, 2],
      image_png: PNG,
    });

    const rows = upserted();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.page_index)).toEqual([0, 1, 2]);
    // One act, one timestamp — the reason the API takes a page list rather
    // than one request per page.
    expect(new Set(rows.map((r) => r.signed_at)).size).toBe(1);
  });

  it('deduplicates and orders the pages it was handed', async () => {
    const { service, upserted } = harness();

    await service.save('contract-1', 'user-1', {
      position: 'hirer',
      method: 'typed',
      initials_text: 'AR',
      pages: [2, 0, 2, 1],
      image_png: PNG,
    });

    expect(upserted().map((r) => r.page_index)).toEqual([0, 1, 2]);
  });

  it('keeps the typed characters as evidence, and drops them for a drawn mark', async () => {
    const { service, upserted } = harness();

    await service.save('contract-1', 'user-1', {
      position: 'provider',
      method: 'typed',
      initials_text: '  JCG  ',
      pages: [0],
      image_png: PNG,
    });
    expect(upserted()[0].initials_text).toBe('JCG');

    await service.save('contract-1', 'user-1', {
      position: 'provider',
      method: 'drawn',
      pages: [0],
      image_png: PNG,
    });
    expect(upserted()[0].initials_text).toBeNull();
  });

  it('refuses to initial an ended or cancelled agreement', async () => {
    for (const status of ['ended', 'cancelled']) {
      const { service } = harness(status);
      await expect(
        service.save('contract-1', 'user-1', {
          position: 'provider',
          method: 'typed',
          initials_text: 'JCG',
          pages: [0],
          image_png: PNG,
        }),
      ).rejects.toThrow(`A ${status} contract can no longer be initialled.`);
    }
  });

  it('rejects anything that is not a PNG data URL', async () => {
    const { service } = harness();
    await expect(
      service.save('contract-1', 'user-1', {
        position: 'provider',
        method: 'drawn',
        pages: [0],
        image_png: 'https://example.com/not-a-data-url.png',
      }),
    ).rejects.toThrow('The initials image must be a PNG data URL.');
  });

  it('takes a URL from a signed-in signer without re-uploading', async () => {
    const { service, uploads, upserted } = harness();

    await service.save('contract-1', 'user-1', {
      position: 'provider',
      method: 'drawn',
      pages: [0],
      image_url: 'https://cdn.test/already-uploaded.png',
    });

    expect(uploads.uploadFile).not.toHaveBeenCalled();
    expect(upserted()[0].image_url).toBe('https://cdn.test/already-uploaded.png');
  });

  it('requires an image by one route or the other', async () => {
    const { service } = harness();
    await expect(
      service.save('contract-1', 'user-1', {
        position: 'provider',
        method: 'typed',
        initials_text: 'JCG',
        pages: [0],
      }),
    ).rejects.toThrow('An initials image is required.');
  });
});
