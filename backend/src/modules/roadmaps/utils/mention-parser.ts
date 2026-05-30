export function extractMentionedUserIds(html: string): string[] {
  const regex = /data-user-id="([^"]+)"/g;
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    if (match[1] && !ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}
