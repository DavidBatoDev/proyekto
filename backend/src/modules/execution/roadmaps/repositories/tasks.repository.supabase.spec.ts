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

describe('TasksRepositorySupabase getHistory retention', () => {
  function historyDb() {
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      gte: jest.fn(() => chain),
      order: jest.fn(() => chain),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    const db = { from: jest.fn(() => chain) } as unknown as SupabaseClient;
    return { db, chain };
  }

  it('hides rows older than the cutoff', async () => {
    const { db, chain } = historyDb();
    await new TasksRepositorySupabase(db).getHistory('task-1', {
      since: '2026-09-15T00:00:00.000Z',
    });

    expect(chain.eq).toHaveBeenCalledWith('task_id', 'task-1');
    expect(chain.gte).toHaveBeenCalledWith(
      'created_at',
      '2026-09-15T00:00:00.000Z',
    );
  });

  it('adds no filter without a cutoff', async () => {
    const { db, chain } = historyDb();
    await new TasksRepositorySupabase(db).getHistory('task-1');

    expect(chain.gte).not.toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalledWith(50);
  });
});
