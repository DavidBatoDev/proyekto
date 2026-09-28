import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { R2_CLIENT, R2_CONFIG, type R2Config } from '../../../config/r2.module';

/**
 * Removes the files a deleted account owned.
 *
 * WHICH PREFIXES, AND WHY NOT ALL OF THEM
 *
 * Every object key is `<prefix>/<uploaderUserId>/<timestamp>.<ext>` on both
 * upload paths (`realtime/src/index.ts` and `uploads.controller.ts`), so the
 * user's own files are a prefix sweep rather than a reconciliation of a dozen
 * `*_url` columns.
 *
 * But the key records WHO UPLOADED, not who owns the surface. A chat attachment
 * still sits in someone else's thread; a task attachment still hangs off a task
 * in a project that survives. Sweeping those would leave live rows pointing at
 * 404s -- destroying other people's data in the name of privacy. So the sweep
 * covers only prefixes where uploader and owner are the same person AND every
 * referencing row is deleted with the account. The rest are retained under
 * exactly the same rule as the messages and comments the person wrote: content
 * contributed to a shared space stays with that space.
 *
 * That is a disclosure obligation, not just a code decision -- `/privacy` has
 * to say it.
 *
 * Runs after the transaction commits, best-effort. An account that is
 * irreversibly gone from the database must not report failure because an object
 * store timed out: the user would retry, get ACCOUNT_ALREADY_DELETED, and
 * conclude nothing happened.
 */

/** Uploader is the owner, and every referencing row goes with the account. */
export const SWEEPABLE_PREFIXES = [
  'avatars',
  'banners',
  'portfolio_projects',
] as const;

/** Same, but in the private bucket. */
export const SWEEPABLE_PRIVATE_PREFIXES = ['identity_documents'] as const;

/**
 * Retained deliberately. Left here as documentation so the next person does not
 * "fix" the list by completing it:
 *   task_attachments, chat_attachments, brief_attachments - in other people's
 *     threads, tasks and briefs;
 *   project_banners, roadmap_previews - belong to a surface that may transfer;
 *   payout_proofs, contract_signatures - evidence attached to financial and
 *     legal records the RESTRICT foreign keys exist to preserve.
 */
export const RETAINED_PREFIXES = [
  'task_attachments',
  'chat_attachments',
  'brief_attachments',
  'project_banners',
  'roadmap_previews',
  'payout_proofs',
  'contract_signatures',
] as const;

export interface StorageSweepResult {
  status: 'done' | 'partial' | 'failed';
  deleted: number;
  error?: string;
}

@Injectable()
export class AccountStorageService {
  private readonly logger = new Logger(AccountStorageService.name);

  constructor(
    @Optional() @Inject(R2_CLIENT) private readonly r2: S3Client | null,
    @Optional() @Inject(R2_CONFIG) private readonly config: R2Config | null,
  ) {}

  /** Never throws. The caller records the outcome and moves on. */
  async sweepUser(userId: string): Promise<StorageSweepResult> {
    if (!this.r2 || !this.config) {
      return {
        status: 'failed',
        deleted: 0,
        error: 'R2 client is not configured',
      };
    }

    let deleted = 0;
    const failures: string[] = [];

    for (const prefix of SWEEPABLE_PREFIXES) {
      const outcome = await this.sweepPrefix(
        this.config.publicBucket,
        `${prefix}/${userId}/`,
      );
      deleted += outcome.deleted;
      if (outcome.error) failures.push(`${prefix}: ${outcome.error}`);
    }

    for (const prefix of SWEEPABLE_PRIVATE_PREFIXES) {
      const outcome = await this.sweepPrefix(
        this.config.privateBucket,
        `${prefix}/${userId}/`,
      );
      deleted += outcome.deleted;
      if (outcome.error) failures.push(`${prefix}: ${outcome.error}`);
    }

    if (failures.length === 0) return { status: 'done', deleted };
    return {
      status: deleted > 0 ? 'partial' : 'failed',
      deleted,
      error: failures.join('; '),
    };
  }

  private async sweepPrefix(
    bucket: string,
    prefix: string,
  ): Promise<{ deleted: number; error?: string }> {
    let deleted = 0;
    let continuationToken: string | undefined;

    try {
      do {
        const listed = await this.r2!.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );

        const keys = (listed.Contents ?? [])
          .map((object) => object.Key)
          .filter((key): key is string => Boolean(key));

        if (keys.length > 0) {
          // DeleteObjects takes 1000 keys per call, which is also the page size
          // ListObjectsV2 returns, so one delete per page is always in range.
          await this.r2!.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
            }),
          );
          deleted += keys.length;
        }

        continuationToken = listed.IsTruncated
          ? listed.NextContinuationToken
          : undefined;
      } while (continuationToken);

      return { deleted };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Storage sweep failed for ${bucket}/${prefix}: ${message}`,
      );
      return { deleted, error: message };
    }
  }
}
