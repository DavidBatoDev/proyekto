import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { projectService, type ProjectInvite } from "@/services/project.service";
import {
  notificationsService,
  type NotificationItem,
} from "@/services/notifications.service";
import { useAuthStore } from "@/stores/authStore";
import { useToast } from "@/hooks/useToast";
import { OPEN_PROJECT_INVITE_MODAL_EVENT } from "./projectInviteModalEvents";

function getInviteNotificationId(
  inviteId: string,
  notifications: NotificationItem[],
): string | null {
  const notification = notifications.find((item) => {
    const typeName = item.type?.name;
    const contentInviteId = item.content?.invite_id;

    return (
      typeName === "project_invite_received" &&
      !item.is_read &&
      typeof contentInviteId === "string" &&
      contentInviteId === inviteId
    );
  });

  return notification?.id ?? null;
}

function sessionSeenKey(inviteId: string) {
  return `project-invite-seen:${inviteId}`;
}

export function ProjectInvitePromptManager() {
  const queryClient = useQueryClient();
  const routerState = useRouterState();
  const navigate = useNavigate();
  const toast = useToast();
  const { isAuthenticated, profile } = useAuthStore();

  const [open, setOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pendingOpenInviteId, setPendingOpenInviteId] = useState<string | null>(
    null,
  );

  const invitesQuery = useQuery({
    queryKey: ["projects", "my-invites"],
    queryFn: () => projectService.getMyInvites(),
    enabled: isAuthenticated,
  });

  const notificationsQuery = useQuery({
    queryKey: ["notifications", "project-invites"],
    queryFn: () => notificationsService.list({ limit: 100 }),
    enabled: isAuthenticated,
  });

  const pendingInvites = useMemo(
    () =>
      (invitesQuery.data || [])
        .filter((invite) => invite.status === "pending")
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
    [invitesQuery.data],
  );

  const unreadProjectInviteNotifications = useMemo(
    () =>
      (notificationsQuery.data || []).filter(
        (item) =>
          item.type?.name === "project_invite_received" && !item.is_read,
      ),
    [notificationsQuery.data],
  );

  const respondMutation = useMutation({
    mutationFn: ({
      inviteId,
      status,
    }: {
      inviteId: string;
      status: "accepted" | "declined";
    }) => projectService.respondInvite(inviteId, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["projects", "my-invites"],
      });
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      await queryClient.invalidateQueries({
        queryKey: ["notifications", "unread-count"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["notifications", "project-invites"],
      });
    },
  });

  useEffect(() => {
    const handleOpenRequest = (event: Event) => {
      const customEvent = event as CustomEvent<{ inviteId?: string }>;
      const inviteId = customEvent.detail?.inviteId;

      if (inviteId) {
        if (!pendingInvites.length) {
          setPendingOpenInviteId(inviteId);
          return;
        }

        const targetIndex = pendingInvites.findIndex(
          (invite) => invite.id === inviteId,
        );
        if (targetIndex >= 0) {
          setCurrentIndex(targetIndex);
          setOpen(true);
          setPendingOpenInviteId(null);
          return;
        }

        setPendingOpenInviteId(inviteId);
        return;
      }

      if (!pendingInvites.length) return;

      setCurrentIndex(0);
      setOpen(true);
      setPendingOpenInviteId(null);
    };

    window.addEventListener(
      OPEN_PROJECT_INVITE_MODAL_EVENT,
      handleOpenRequest as EventListener,
    );
    return () => {
      window.removeEventListener(
        OPEN_PROJECT_INVITE_MODAL_EVENT,
        handleOpenRequest as EventListener,
      );
    };
  }, [pendingInvites]);

  useEffect(() => {
    if (!pendingOpenInviteId || !pendingInvites.length) return;

    const targetIndex = pendingInvites.findIndex(
      (invite) => invite.id === pendingOpenInviteId,
    );

    if (targetIndex < 0) return;

    setCurrentIndex(targetIndex);
    setOpen(true);
    setPendingOpenInviteId(null);
  }, [pendingOpenInviteId, pendingInvites]);

  useEffect(() => {
    if (!isAuthenticated || !profile?.id) return;
    if (!routerState.location.pathname.startsWith("/dashboard")) return;
    if (!pendingInvites.length || !unreadProjectInviteNotifications.length)
      return;

    const pendingWithUnreadNotification = pendingInvites.find((invite) =>
      unreadProjectInviteNotifications.some((notification) => {
        const contentInviteId = notification.content?.invite_id;
        return (
          typeof contentInviteId === "string" && contentInviteId === invite.id
        );
      }),
    );

    if (!pendingWithUnreadNotification) return;

    if (
      sessionStorage.getItem(sessionSeenKey(pendingWithUnreadNotification.id))
    ) {
      return;
    }

    const targetIndex = pendingInvites.findIndex(
      (invite) => invite.id === pendingWithUnreadNotification.id,
    );
    if (targetIndex >= 0) {
      setCurrentIndex(targetIndex);
      setOpen(true);
      sessionStorage.setItem(
        sessionSeenKey(pendingWithUnreadNotification.id),
        "1",
      );
    }
  }, [
    isAuthenticated,
    profile?.id,
    routerState.location.pathname,
    pendingInvites,
    unreadProjectInviteNotifications,
  ]);

  useEffect(() => {
    if (!pendingInvites.length) {
      setOpen(false);
      return;
    }

    if (currentIndex > pendingInvites.length - 1) {
      setCurrentIndex(0);
    }
  }, [pendingInvites, currentIndex]);

  if (!isAuthenticated || !open || pendingInvites.length === 0) {
    return null;
  }

  const currentInvite: ProjectInvite = pendingInvites[currentIndex];
  if (!currentInvite) return null;

  const pendingCount = pendingInvites.length;

  const handleRespond = async (status: "accepted" | "declined") => {
    try {
      const acceptedProjectId =
        status === "accepted" ? currentInvite.project_id : null;
      const notificationId = getInviteNotificationId(
        currentInvite.id,
        notificationsQuery.data || [],
      );

      if (acceptedProjectId) {
        toast.info("Joining project... Redirecting", 3000);
      }

      await respondMutation.mutateAsync({ inviteId: currentInvite.id, status });

      if (notificationId) {
        await notificationsService.markRead(notificationId, true);
        await queryClient.invalidateQueries({ queryKey: ["notifications"] });
        await queryClient.invalidateQueries({
          queryKey: ["notifications", "unread-count"],
        });
      }

      if (acceptedProjectId) {
        setOpen(false);
        navigate({
          to: "/project/$projectId/roadmap",
          params: { projectId: acceptedProjectId },
        });
        return;
      }

      if (pendingCount <= 1) {
        setOpen(false);
        return;
      }

      setCurrentIndex((prev) => {
        if (prev >= pendingCount - 1) return 0;
        return prev;
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to respond to invite.",
      );
    }
  };

  return (
    <div className="fixed inset-0 z-10050 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <button
          type="button"
          className="absolute right-3 top-3 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          onClick={() => setOpen(false)}
          aria-label="Close invite modal"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#ff9933]">
              Project Invitation
            </p>
            <h2 className="mt-1 text-xl font-bold text-gray-900">
              Join {currentInvite.project?.title || "this project"}?
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {currentInvite.inviter?.display_name || "A team lead"} invited you
              to collaborate.
            </p>
          </div>

          {currentInvite.message ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              {currentInvite.message}
            </div>
          ) : null}

          <p className="text-xs text-gray-500">
            Sent {new Date(currentInvite.created_at).toLocaleString()}
          </p>

          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setCurrentIndex((prev) =>
                    prev === 0 ? pendingCount - 1 : prev - 1,
                  )
                }
                disabled={pendingCount <= 1}
                className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                aria-label="Previous invite"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setCurrentIndex((prev) =>
                    prev + 1 >= pendingCount ? 0 : prev + 1,
                  )
                }
                disabled={pendingCount <= 1}
                className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                aria-label="Next invite"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="text-xs text-gray-500">
                {currentIndex + 1} / {pendingCount}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                disabled={respondMutation.isPending}
              >
                Later
              </button>
              <button
                type="button"
                onClick={() => void handleRespond("declined")}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                disabled={respondMutation.isPending}
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => void handleRespond("accepted")}
                className="rounded-xl bg-[#ff9933] px-3 py-2 text-sm font-semibold text-white hover:bg-[#f28a22] disabled:opacity-60"
                disabled={respondMutation.isPending}
              >
                {respondMutation.isPending ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Joining...
                  </span>
                ) : (
                  "Join Project"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
