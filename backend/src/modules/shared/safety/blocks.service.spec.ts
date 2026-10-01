import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findBlockerIds } from './blocks.queries';
import { BlocksService } from './blocks.service';
import type { SafetyRepository } from './repositories/safety.repository.interface';

function setup(profileExists = true) {
  const addBlock = jest.fn().mockResolvedValue(undefined);
  const removeBlock = jest.fn().mockResolvedValue(undefined);
  const isBlockedEitherWay = jest.fn().mockResolvedValue(true);
  const findProfile = jest
    .fn()
    .mockResolvedValue(
      profileExists ? { id: 'b', name: 'B', email: null } : null,
    );
  const repo = {
    addBlock,
    removeBlock,
    isBlockedEitherWay,
    findProfile,
  } as unknown as SafetyRepository;
  return {
    service: new BlocksService(repo),
    addBlock,
    removeBlock,
    isBlockedEitherWay,
  };
}

describe('BlocksService', () => {
  it('blocks an existing person', async () => {
    const { service, addBlock } = setup();
    await service.block('a', 'b');
    expect(addBlock).toHaveBeenCalledWith('a', 'b');
  });

  it("won't block yourself", async () => {
    const { service, addBlock } = setup();
    await expect(service.block('a', 'a')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(addBlock).not.toHaveBeenCalled();
  });

  it('404s for someone who does not exist', async () => {
    const { service } = setup(false);
    await expect(service.block('a', 'ghost')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('unblocks', async () => {
    const { service, removeBlock } = setup();
    await service.unblock('a', 'b');
    expect(removeBlock).toHaveBeenCalledWith('a', 'b');
  });

  it('never treats a person as blocked from themselves', async () => {
    const { service, isBlockedEitherWay } = setup();
    await expect(service.isBlockedEitherWay('a', 'a')).resolves.toBe(false);
    expect(isBlockedEitherWay).not.toHaveBeenCalled();
  });
});

describe('findBlockerIds', () => {
  const fakeDb = (result: { data: unknown; error: unknown }) => {
    const inFn = jest.fn().mockResolvedValue(result);
    const eq = jest.fn().mockReturnValue({ in: inFn });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    return { db: { from } as unknown as SupabaseClient, from, inFn };
  };

  it('returns the candidates who blocked the author', async () => {
    const { db, inFn } = fakeDb({
      data: [{ blocker_id: 'x' }],
      error: null,
    });
    const blockers = await findBlockerIds(db, 'author', ['x', 'y', 'author']);
    expect([...blockers]).toEqual(['x']);
    // The author is never a candidate for blocking themselves.
    expect(inFn).toHaveBeenCalledWith('blocker_id', ['x', 'y']);
  });

  it('skips the query when there is nobody to check', async () => {
    const { db, from } = fakeDb({ data: [], error: null });
    await expect(findBlockerIds(db, 'author', ['author'])).resolves.toEqual(
      new Set(),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it('fails open on a query error', async () => {
    const { db } = fakeDb({ data: null, error: { message: 'boom' } });
    await expect(findBlockerIds(db, 'author', ['x'])).resolves.toEqual(
      new Set(),
    );
  });
});
