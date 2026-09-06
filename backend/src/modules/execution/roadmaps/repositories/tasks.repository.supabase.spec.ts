import { ConflictException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TasksRepositorySupabase } from './tasks.repository.supabase';

describe('TasksRepositorySupabase update conflicts', () => {
  it('maps a task-position unique violation to HTTP 409', async () => {
    const eq = jest.fn().mockResolvedValue({
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "roadmap_tasks_feature_id_position_key"',
      },
    });
    const db = {
      from: jest.fn().mockReturnValue({
        update: jest.fn().mockReturnValue({ eq }),
      }),
    } as unknown as SupabaseClient;
    const repository = new TasksRepositorySupabase(db);

    await expect(
      repository.update('task-1', { title: 'Renamed' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
