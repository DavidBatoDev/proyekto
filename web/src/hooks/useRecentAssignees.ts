import { useCallback, useEffect, useMemo, useState } from "react";
import { useProfile, useUser } from "@/stores/authStore";
import { useProjectMembersQuery } from "./useProjectQueries";
import type { ProjectMember } from "@/services/project.service";

export interface DockAvatar {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  isSelf: boolean;
}

const STORAGE_KEY_PREFIX = "roadmap.recentAssignees.";
const CHANGE_EVENT = "roadmap.recentAssignees.changed";
const MAX_TRACKED_RECENTS = 10;
const MAX_DOCK_AVATARS = 5;

const getStorageKey = (projectId: string) => `${STORAGE_KEY_PREFIX}${projectId}`;

const readRecents = (projectId: string): string[] => {
  if (typeof window === "undefined" || !projectId) return [];
  try {
    const raw = window.sessionStorage.getItem(getStorageKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
};

const writeRecents = (projectId: string, ids: string[]): void => {
  if (typeof window === "undefined" || !projectId) return;
  try {
    window.sessionStorage.setItem(getStorageKey(projectId), JSON.stringify(ids));
  } catch {
    // ignore quota / unavailable storage
  }
};

export function recordRecentAssignment(
  projectId: string,
  userId: string,
): void {
  if (!projectId || !userId) return;
  const current = readRecents(projectId);
  const filtered = current.filter((id) => id !== userId);
  const next = [userId, ...filtered].slice(0, MAX_TRACKED_RECENTS);
  writeRecents(projectId, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(CHANGE_EVENT, { detail: { projectId } }),
    );
  }
}

const resolveMemberName = (member: ProjectMember): string => {
  const u = member.user;
  if (!u) return member.position ?? "Member";
  if (u.display_name && u.display_name.trim()) return u.display_name;
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  return u.email ?? "Member";
};

export function useRecentAssignees(projectId: string) {
  const user = useUser();
  const profile = useProfile();
  const membersQuery = useProjectMembersQuery(projectId);
  const members = useMemo(
    () => membersQuery.data ?? [],
    [membersQuery.data],
  );

  const [recents, setRecents] = useState<string[]>(() => readRecents(projectId));

  useEffect(() => {
    setRecents(readRecents(projectId));
    if (typeof window === "undefined") return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId === projectId) {
        setRecents(readRecents(projectId));
      }
    };
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, [projectId]);

  const avatars = useMemo<DockAvatar[]>(() => {
    const out: DockAvatar[] = [];
    const seen = new Set<string>();

    if (user?.id) {
      const selfFromProfile =
        (profile?.display_name && profile.display_name.trim()) ||
        [profile?.first_name, profile?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim();
      const selfName =
        selfFromProfile || profile?.email || user.email || "You";
      out.push({
        userId: user.id,
        displayName: selfName,
        avatarUrl: profile?.avatar_url ?? null,
        isSelf: true,
      });
      seen.add(user.id);
    }

    const memberByUserId = new Map<string, ProjectMember>();
    for (const member of members) {
      if (member.user_id) memberByUserId.set(member.user_id, member);
    }

    for (const userId of recents) {
      if (out.length >= MAX_DOCK_AVATARS) break;
      if (seen.has(userId)) continue;
      const member = memberByUserId.get(userId);
      if (!member?.user_id) continue;
      out.push({
        userId: member.user_id,
        displayName: resolveMemberName(member),
        avatarUrl: member.user?.avatar_url ?? null,
        isSelf: false,
      });
      seen.add(member.user_id);
    }

    for (const member of members) {
      if (out.length >= MAX_DOCK_AVATARS) break;
      if (!member.user_id || seen.has(member.user_id)) continue;
      out.push({
        userId: member.user_id,
        displayName: resolveMemberName(member),
        avatarUrl: member.user?.avatar_url ?? null,
        isSelf: false,
      });
      seen.add(member.user_id);
    }

    return out;
  }, [user, profile, recents, members]);

  const recordAssignment = useCallback(
    (userId: string) => {
      recordRecentAssignment(projectId, userId);
    },
    [projectId],
  );

  return { avatars, recordAssignment };
}
