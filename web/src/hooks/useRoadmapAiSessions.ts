import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  roadmapAiSessionsService,
  type AppendRoadmapAiMessagePayload,
  type AppendRoadmapAiMessageResult,
  type CreateRoadmapAiSessionPayload,
  type RoadmapAiMessage,
  type RoadmapAiSession,
  type UpdateRoadmapAiSessionPayload,
} from "@/services/roadmap-ai-sessions.service";

export const roadmapAiSessionKeys = {
  all: (roadmapId: string) => ["roadmap-ai-sessions", roadmapId] as const,
  list: (roadmapId: string, archived: boolean) =>
    ["roadmap-ai-sessions", roadmapId, "list", { archived }] as const,
  detail: (roadmapId: string, sessionId: string) =>
    ["roadmap-ai-sessions", roadmapId, "detail", sessionId] as const,
  messages: (roadmapId: string, sessionId: string) =>
    ["roadmap-ai-sessions", roadmapId, "messages", sessionId] as const,
};

export function useRoadmapAiSessionsList(
  roadmapId: string | null | undefined,
  options: { archived?: boolean } = {},
) {
  const archived = options.archived ?? false;
  return useQuery({
    queryKey: roadmapAiSessionKeys.list(roadmapId ?? "", archived),
    queryFn: () => roadmapAiSessionsService.list(roadmapId!, { archived }),
    enabled: Boolean(roadmapId),
    staleTime: 30 * 1000,
  });
}

export function useRoadmapAiMessages(
  roadmapId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  return useQuery({
    queryKey: roadmapAiSessionKeys.messages(roadmapId ?? "", sessionId ?? ""),
    queryFn: () =>
      roadmapAiSessionsService.listMessages(roadmapId!, sessionId!, {
        limit: 100,
      }),
    enabled: Boolean(roadmapId && sessionId),
    staleTime: 5 * 1000,
  });
}

export function useCreateRoadmapAiSession(roadmapId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateRoadmapAiSessionPayload = {}) =>
      roadmapAiSessionsService.create(roadmapId, payload),
    onSuccess: (created) => {
      // Seed the new session into the active-list cache synchronously so the
      // panel's auto-select reconciliation finds it immediately. Without this,
      // setActiveThread(newId) runs before the invalidate-triggered refetch
      // lands; the reconcile effect doesn't see newId in the stale list and
      // bounces back to threads[0] -- the "New thread flashes then reverts to
      // the old thread" bug. The refetch below still reconciles server fields.
      queryClient.setQueryData<RoadmapAiSession[]>(
        roadmapAiSessionKeys.list(roadmapId, false),
        (prev) =>
          prev
            ? [created, ...prev.filter((s) => s.id !== created.id)]
            : [created],
      );
      queryClient.invalidateQueries({
        queryKey: roadmapAiSessionKeys.all(roadmapId),
      });
    },
  });
}

export function useUpdateRoadmapAiSession(roadmapId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      payload,
    }: {
      sessionId: string;
      payload: UpdateRoadmapAiSessionPayload;
    }) => roadmapAiSessionsService.update(roadmapId, sessionId, payload),
    // Optimistic update for pin/archive/rename — feels instant in the picker.
    onMutate: async ({ sessionId, payload }) => {
      await queryClient.cancelQueries({
        queryKey: roadmapAiSessionKeys.all(roadmapId),
      });
      const previous = new Map<unknown, RoadmapAiSession[] | undefined>();
      for (const archived of [false, true]) {
        const key = roadmapAiSessionKeys.list(roadmapId, archived);
        const existing = queryClient.getQueryData<RoadmapAiSession[]>(key);
        previous.set(key, existing);
        if (!existing) continue;
        queryClient.setQueryData<RoadmapAiSession[]>(
          key,
          existing.map((s) =>
            s.id === sessionId ? { ...s, ...payload } : s,
          ),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      for (const [key, data] of context.previous.entries()) {
        queryClient.setQueryData(key as ReturnType<typeof roadmapAiSessionKeys.list>, data);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: roadmapAiSessionKeys.all(roadmapId),
      });
    },
  });
}

export function useDeleteRoadmapAiSession(roadmapId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      roadmapAiSessionsService.delete(roadmapId, sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: roadmapAiSessionKeys.all(roadmapId),
      });
    },
  });
}

export function useAppendRoadmapAiMessage(roadmapId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      payload,
    }: {
      sessionId: string;
      payload: AppendRoadmapAiMessagePayload;
    }): Promise<AppendRoadmapAiMessageResult> =>
      roadmapAiSessionsService.appendMessage(roadmapId, sessionId, payload),
    onSuccess: (_result, { sessionId }) => {
      queryClient.invalidateQueries({
        queryKey: roadmapAiSessionKeys.messages(roadmapId, sessionId),
      });
      // Session list shows last_message_at and message_count, both of which
      // change on insert; cheap to invalidate.
      queryClient.invalidateQueries({
        queryKey: roadmapAiSessionKeys.all(roadmapId),
      });
    },
  });
}

export type { RoadmapAiMessage, RoadmapAiSession };
