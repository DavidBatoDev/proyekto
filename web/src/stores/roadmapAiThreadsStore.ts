import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// Lightweight client-side state for the AI thread picker.
// We only persist which thread is active per roadmap and the unsent draft
// input per thread; everything else (thread list, messages, titles) is server
// state owned by React Query.
//
// localStorage (not sessionStorage) so the active thread survives a reload.

interface RoadmapAiThreadsState {
  activeThreadIdByRoadmap: Record<string, string | null>;
  draftInputByThread: Record<string, string>;
  setActiveThread: (roadmapId: string, threadId: string | null) => void;
  setDraftInput: (threadId: string, value: string) => void;
  clearDraftInput: (threadId: string) => void;
  clearRoadmapState: (roadmapId: string) => void;
}

export const useRoadmapAiThreadsStore = create<RoadmapAiThreadsState>()(
  persist(
    (set) => ({
      activeThreadIdByRoadmap: {},
      draftInputByThread: {},

      setActiveThread: (roadmapId, threadId) =>
        set((state) => ({
          activeThreadIdByRoadmap: {
            ...state.activeThreadIdByRoadmap,
            [roadmapId]: threadId,
          },
        })),

      setDraftInput: (threadId, value) =>
        set((state) => ({
          draftInputByThread: {
            ...state.draftInputByThread,
            [threadId]: value,
          },
        })),

      clearDraftInput: (threadId) =>
        set((state) => {
          if (!(threadId in state.draftInputByThread)) return state;
          const next = { ...state.draftInputByThread };
          delete next[threadId];
          return { draftInputByThread: next };
        }),

      clearRoadmapState: (roadmapId) =>
        set((state) => {
          if (!(roadmapId in state.activeThreadIdByRoadmap)) return state;
          const next = { ...state.activeThreadIdByRoadmap };
          delete next[roadmapId];
          return { activeThreadIdByRoadmap: next };
        }),
    }),
    {
      name: "roadmap.ai.threads.v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeThreadIdByRoadmap: state.activeThreadIdByRoadmap,
        draftInputByThread: state.draftInputByThread,
      }),
    },
  ),
);

export function useActiveRoadmapAiThread(roadmapId: string): string | null {
  return useRoadmapAiThreadsStore(
    (s) => s.activeThreadIdByRoadmap[roadmapId] ?? null,
  );
}
