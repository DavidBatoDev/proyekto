import type { ListMeetingsParams } from "@/services/meetings.service";

/**
 * Query key factory for meeting queries. Mirrors the consultantKeys pattern in
 * queries/consultants.ts. `list`/`project` fold the filter params into the key
 * so range-scoped calendar queries cache independently.
 */
export const meetingKeys = {
  all: ["meetings"] as const,
  lists: () => [...meetingKeys.all, "list"] as const,
  list: (params?: ListMeetingsParams) =>
    [...meetingKeys.lists(), params ?? {}] as const,
  project: (projectId: string, params?: ListMeetingsParams) =>
    [...meetingKeys.all, "project", projectId, params ?? {}] as const,
  detail: (id: string) => [...meetingKeys.all, "detail", id] as const,
};
