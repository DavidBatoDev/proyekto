import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectService } from "@/services/project.service";
import {
  fetchMyProjectPermissions,
  fetchLinkedRoadmap,
  fetchProject,
  fetchProjectBrief,
  fetchProjectMembers,
  fetchProjectResources,
  fetchRoadmapFull,
  projectKeys,
} from "@/queries/project";

const STALE_30S = 30 * 1000;
const STALE_60S = 60 * 1000;

export function useProjectDetailQuery(projectId: string) {
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => fetchProject(projectId),
    enabled: Boolean(projectId),
    staleTime: STALE_60S,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useProjectMembersQuery(projectId: string) {
  return useQuery({
    queryKey: projectKeys.members(projectId),
    queryFn: () => fetchProjectMembers(projectId),
    enabled: Boolean(projectId),
    staleTime: STALE_60S,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useProjectMyPermissionsQuery(projectId: string) {
  return useQuery({
    queryKey: projectKeys.myPermissions(projectId),
    queryFn: () => fetchMyProjectPermissions(projectId),
    enabled: Boolean(projectId),
    staleTime: STALE_60S,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useProjectResourcesQuery(projectId: string) {
  return useQuery({
    queryKey: projectKeys.resources(projectId),
    queryFn: () => fetchProjectResources(projectId),
    enabled: Boolean(projectId),
    staleTime: STALE_30S,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useLinkedRoadmapQuery(projectId: string) {
  return useQuery({
    queryKey: projectKeys.linkedRoadmap(projectId),
    queryFn: () => fetchLinkedRoadmap(projectId),
    enabled: Boolean(projectId),
    staleTime: STALE_60S,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useProjectBriefQuery(projectId: string) {
  return useQuery({
    queryKey: projectKeys.brief(projectId),
    queryFn: () => fetchProjectBrief(projectId),
    enabled: Boolean(projectId),
    staleTime: STALE_60S,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useRoadmapFullQuery(roadmapId: string) {
  return useQuery({
    queryKey: projectKeys.roadmapFull(roadmapId),
    queryFn: () => fetchRoadmapFull(roadmapId),
    enabled: Boolean(roadmapId),
    staleTime: STALE_30S,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useRoadmapFullLiveQuery(roadmapId: string) {
  return useQuery({
    queryKey: projectKeys.roadmapFull(roadmapId),
    queryFn: () => fetchRoadmapFull(roadmapId),
    enabled: Boolean(roadmapId),
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  });
}

export function useProjectCancelInviteMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (inviteId: string) =>
      projectService.cancelInvite(projectId, inviteId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.invites(projectId) });
    },
  });
}

export function useProjectInvitesQuery(projectId: string) {
  return useQuery({
    queryKey: projectKeys.invites(projectId),
    queryFn: () => projectService.getProjectInvites(projectId),
    enabled: Boolean(projectId),
    staleTime: STALE_30S,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useProjectRolePermissionsQuery(
  projectId: string,
  role: "consultant" | "client" | "freelancer",
) {
  return useQuery({
    queryKey: projectKeys.rolePermissions(projectId, role),
    queryFn: () => projectService.getRolePermissions(projectId, role),
    enabled: Boolean(projectId),
    staleTime: STALE_60S,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useProjectInviteMemberMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { email: string; role?: string; position?: string; message?: string }) =>
      projectService.inviteByEmail(projectId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.members(projectId) });
      await queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      await queryClient.invalidateQueries({ queryKey: projectKeys.invites(projectId) });
    },
  });
}

export function useProjectRemoveMemberMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberId: string) => projectService.removeMember(projectId, memberId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.members(projectId) });
      await queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

export function useInvalidateProjectQueries(projectId: string) {
  const queryClient = useQueryClient();

  return {
    invalidateProject: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) }),
    invalidateMembers: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.members(projectId) }),
    invalidateMyPermissions: () =>
      queryClient.invalidateQueries({
        queryKey: projectKeys.myPermissions(projectId),
      }),
    invalidateResources: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.resources(projectId) }),
    invalidateLinkedRoadmap: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.linkedRoadmap(projectId) }),
    invalidateBrief: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.brief(projectId) }),
  };
}
