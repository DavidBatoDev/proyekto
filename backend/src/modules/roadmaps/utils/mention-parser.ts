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
