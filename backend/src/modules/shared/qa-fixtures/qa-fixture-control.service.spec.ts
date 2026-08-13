import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { QaFixtureControlService } from './qa-fixture-control.service';

describe('QaFixtureControlService', () => {
  it('passes only the registry key and success marker to the reset RPC', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { key: 'billing-v1', project_id: 'project-1' },
      error: null,
    });
    const service = new QaFixtureControlService({
      rpc,
    } as unknown as SupabaseClient);
    await expect(service.reset('billing-v1', true)).resolves.toMatchObject({
      key: 'billing-v1',
    });
    expect(rpc).toHaveBeenCalledWith('reset_qa_fixture', {
      p_key: 'billing-v1',
      p_mark_success: true,
    });
  });

  it('maps an unknown key to 404', async () => {
    const service = new QaFixtureControlService({
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'QA_FIXTURE_NOT_FOUND' },
      }),
    } as unknown as SupabaseClient);
    await expect(service.reset('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('surfaces contamination as a structured reset failure', async () => {
    const service = new QaFixtureControlService({
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'QA_FIXTURE_HAS_PAID_LOG' },
      }),
    } as unknown as SupabaseClient);
    await expect(service.reset('billing-v1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
