/**
 * Mention targets, as `data-user-id` attributes emitted by the comment editor.
 *
 * These are CLIENT-SUPPLIED and therefore untrusted: the ids here are whatever
 * the author's browser put in the HTML, not a verified membership list. Every
 * caller must narrow them to people who can actually see the surrounding content
 * before notifying (see RoadmapAuthorizationService.filterUsersWhoCanViewRoadmap).
 */
export function extractMentionedUserIds(html: string): string[] {
  const regex = /data-user-id="([^"]+)"/g;
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    if (match[1] && !ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

/** How many strangers one comment may invite. */
export const MAX_EMAIL_MENTIONS_PER_COMMENT = 5;

/** RFC 5321 maximum for a forward path. */
const MAX_EMAIL_LENGTH = 254;

/**
 * Conservative on purpose. This is not trying to accept every address RFC 5322
 * permits — it is trying to reject anything that has no business becoming the
 * `to:` of an outbound message.
 */
const EMAIL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * Email mention targets, as `data-invite-email` attributes from the comment
 * editor.
 *
 * **This is the spam-relay chokepoint of the whole product.** Its sibling above
 * is untrusted too, but the worst case there is notifying the wrong member. Here
 * the worst case is Proyekto sending mail, from Proyekto's own domain, to an
 * arbitrary address chosen by the author, containing text the author wrote. So
 * unlike `extractMentionedUserIds` this one validates and bounds rather than
 * handing the raw capture onward:
 *
 * - lowercased and trimmed, so the caller can compare and store one form;
 * - rejected unless it looks like an address and fits in 254 bytes;
 * - deduped;
 * - capped, so a single comment cannot fan out arbitrarily.
 *
 * The caller must STILL check that the author is allowed to invite and that the
 * address is not suppressed — this function only guarantees the strings are
 * plausible addresses.
 */
export function extractMentionedEmails(html: string): string[] {
  const regex = /data-invite-email="([^"]*)"/g;
  const emails: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const candidate = (match[1] ?? '').trim().toLowerCase();
    if (!candidate || candidate.length > MAX_EMAIL_LENGTH) continue;
    if (!EMAIL_RE.test(candidate)) continue;
    if (emails.includes(candidate)) continue;

    emails.push(candidate);
    if (emails.length >= MAX_EMAIL_MENTIONS_PER_COMMENT) break;
  }

  return emails;
}
