import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContractRow } from './contracts.service';
import { ContractSignatureLinksService } from './contract-signature-links.service';

describe('ContractSignatureLinksService QA fixture safety', () => {
  it('blocks requested email delivery before creating or revoking a link', async () => {
    const from = jest.fn();
    const supabase = { from } as unknown as SupabaseClient;
    const contracts = {
      getContractRowForLink: jest.fn().mockResolvedValue({
        id: 'contract-1',
        project_id: 'project-1',
        status: 'draft',
        service_start_date: '2026-01-01',
        service_end_date: '2026-12-31',
      } as ContractRow),
    };
    const financeAccess = { assertProject: jest.fn().mockResolvedValue({}) };
    const qaFixtures = {
      assertProjectSideEffectAllowed: jest
        .fn()
        .mockRejectedValue(new Error('fixture blocked')),
    };
    const service = new ContractSignatureLinksService(
      supabase,
      contracts as never,
      financeAccess as never,
      {} as never,
      {} as never,
      {} as never,
      qaFixtures as never,
    );

    await expect(
      service.createLink('consultant-1', 'contract-1', {
        send_email: true,
        recipient_email: 'qa@example.invalid',
      }),
    ).rejects.toThrow('fixture blocked');
    expect(qaFixtures.assertProjectSideEffectAllowed).toHaveBeenCalledWith(
      'project-1',
      'Contract signature-link email delivery',
    );
    expect(from).not.toHaveBeenCalled();
  });
});
