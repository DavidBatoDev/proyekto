import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BlockedUser,
  SafetyRepository,
} from './repositories/safety.repository.interface';
import { SAFETY_REPOSITORY } from './safety.tokens';

/**
 * Who has blocked whom (App Store guideline 1.2).
 *
 * Deliberately dependency-free apart from its repository: chat imports this to
 * close DMs and drop notifications, and the report flow imports chat, so this
 * must sit below both to avoid a module cycle.
 *
 * What a block does:
 *  - DMs are closed both ways (ChatService.assertNotBlocked); the thread
 *    stays listed and the web shows a banner in place of the composer.
 *  - The blocker gets no push, bell or email about the blocked person
 *    (channel sends and comment mentions).
 *  - The web collapses the blocked person's messages and comments for the
 *    blocker. They still share projects, so the content stays for everyone else.
 */
@Injectable()
export class BlocksService {
  constructor(
    @Inject(SAFETY_REPOSITORY) private readonly repo: SafetyRepository,
  ) {}

  listBlocks(userId: string): Promise<BlockedUser[]> {
    return this.repo.listBlocks(userId);
  }

  isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    if (!a || !b || a === b) return Promise.resolve(false);
    return this.repo.isBlockedEitherWay(a, b);
  }

  /** Of `candidateIds`, the people who have blocked `senderId`. */
  blockersOf(senderId: string, candidateIds: string[]): Promise<Set<string>> {
    return this.repo.blockersAmong(senderId, candidateIds);
  }

  async block(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) {
      throw new BadRequestException("You can't block yourself.");
    }
    const profile = await this.repo.findProfile(blockedId);
    if (!profile) throw new NotFoundException('Person not found.');
    await this.repo.addBlock(blockerId, blockedId);
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    await this.repo.removeBlock(blockerId, blockedId);
  }
}
