import { BadRequestException } from '@nestjs/common';

/**
 * Turn an assert_comment_reply_shape trigger rejection into a 400.
 *
 * The reply-shape rules (one level deep, parent must exist, parent must sit on
 * the same node) live in a BEFORE trigger rather than the service, so a bad
 * parent_id arrives here as a generic Postgres error. Left alone it becomes a
 * 500 — telling the caller "we broke" when in fact they sent an invalid parent.
 *
 * Matched on the message text because that is all PostgREST forwards: a
 * plpgsql RAISE EXCEPTION carries SQLSTATE P0001 with no distinguishing
 * constraint name. The three phrases are the ones the trigger raises; keep this
 * in step with 20260819170000 if they ever change.
 */
const REPLY_SHAPE_MARKERS = [
  'comment threads are one level deep',
  'a reply must sit on the same',
  'does not exist',
  'cannot reply to itself',
];

export function rethrowCommentThreadError(message: string): never {
  const lower = message.toLowerCase();
  if (REPLY_SHAPE_MARKERS.some((m) => lower.includes(m))) {
    throw new BadRequestException(message);
  }
  throw new Error(message);
}
