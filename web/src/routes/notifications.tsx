import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  Trash2,
  CheckCircle2,
  Briefcase,
  Info,
  XCircle,
  MessageCircle,
  Clock3,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  notificationsService,
  type NotificationItem,
} from "@/services/notifications.service";
import { useAuthStore } from "@/stores/authStore";
import { useNotificationsRealtime } from "@/hooks/useNotificationsRealtime";

export const Route = createFileRoute("/notifications")({
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated) throw redirect({ to: "/auth/login" });
  },
  component: NotificationsPage,
});

function getNotificationTitle(item: NotificationItem) {
  const name = item.type?.name;
  if (name === "project_invite_received") return "New project invite";
  if (name === "project_invite_responded") return "Invite response";
  if (name === "marketplace_profile_live") return "Profile is live";
  if (name === "task_assigned") return "Task assigned";
  if (name === "time_log_approval_requested") return "Time approval requested";
  if (name === "time_log_approved") return "Time log approved";
  if (name === "time_log_rejected") return "Time log rejected";
  if (name === "time_log_pending") return "Time log reset to pending";
  if (name === "time_log_day_rejected") return "Daily logs rejected";
  if (name === "time_log_comment_added") return "Time log comment";
  if (name === "task_comment_mention") return "Mentioned in task";
  if (name === "feature_comment_mention") return "Mentioned in feature";
  if (name === "epic_comment_mention") return "Mentioned in epic";
  return "Notification";
}

function getNotificationBody(item: NotificationItem) {
  const message = item.content?.message;
  if (typeof message === "string" && message.trim()) return message;
  const reason = item.content?.reason;
  if (typeof reason === "string" && reason.trim()) {
    return `Reason: ${reason}`;
  }
  const day = item.content?.day;
  if (typeof day === "string" && day.trim()) {
    return `Day: ${day}`;
  }
  const status = item.content?.status;
  if (typeof status === "string") {
    if (status === "approved") return "Your logged time was approved.";
    if (status === "rejected") return "Your logged time was rejected.";
    if (status === "pending") return "A time log was moved back to pending.";
    return `Invite was ${status}.`;
  }
  return "You have an update.";
}

function getNotificationIcon(item: NotificationItem) {
  const name = item.type?.name;
  if (
    name === "project_invite_received" ||
    name === "project_invite_responded"
  ) {
    return <Briefcase className="w-5 h-5 text-blue-500" />;
  }
  if (name === "marketplace_profile_live") {
    return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
  }
  if (name === "task_assigned") {
    return <Briefcase className="w-5 h-5 text-sky-600" />;
  }
  if (name === "time_log_approval_requested") {
    return <Clock3 className="w-5 h-5 text-amber-600" />;
  }
  if (name === "time_log_approved") {
    return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
  }
  if (name === "time_log_rejected" || name === "time_log_day_rejected") {
    return <XCircle className="w-5 h-5 text-rose-500" />;
  }
  if (name === "time_log_comment_added") {
    return <MessageCircle className="w-5 h-5 text-orange-500" />;
  }
  if (
    name === "task_comment_mention" ||
    name === "feature_comment_mention" ||
    name === "epic_comment_mention"
  ) {
    return <MessageCircle className="w-5 h-5 text-violet-500" />;
  }
  return <Info className="w-5 h-5 text-gray-400" />;
}

function NotificationsPage() {
  const queryClient = useQueryClient();
  const profile = useAuthStore((state) => state.profile);

  useNotificationsRealtime(profile?.id);

  const notificationsQuery = useQuery({
    queryKey: ["notifications", "page"],
    queryFn: () => notificationsService.list({ limit: 100 }),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsService.markRead(id, true),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({
        queryKey: ["notifications", "unread-count"],
      });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => notificationsService.markAllRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({
        queryKey: ["notifications", "unread-count"],
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => notificationsService.deleteOne(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({
        queryKey: ["notifications", "unread-count"],
      });
    },
  });

  const notifications = notificationsQuery.data || [];
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="min-h-screen bg-[#f6f7f8] relative overflow-hidden pt-20">
      {/* Animated Background */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.svg
          className="absolute top-0 left-0 w-full h-[400px] opacity-30"
          viewBox="0 0 1440 320"
          preserveAspectRatio="none"
          animate={{ y: [0, -15, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        >
          <motion.path
            d="M0,96L48,112C96,128,192,160,288,160C384,160,480,128,576,122.7C672,117,768,139,864,144C960,149,1056,139,1152,128C1248,117,1344,107,1392,101.3L1440,96L1440,0L1392,0C1344,0,1248,0,1152,0C1056,0,960,0,864,0C768,0,672,0,576,0C480,0,384,0,288,0C192,0,96,0,48,0L0,0Z"
            fill="url(#gradient-blue-indigo)"
            fillOpacity="0.4"
          />
          <defs>
            <linearGradient
              id="gradient-blue-indigo"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="0%"
            >
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>
        </motion.svg>
        <motion.div
          className="absolute top-10 right-20 w-[300px] h-[300px] bg-blue-400 rounded-full blur-3xl opacity-20 mix-blend-multiply"
          animate={{ scale: [1, 1.2, 1], x: [0, -20, 0], y: [0, 30, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 relative z-10 pb-24">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-3">
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="w-12 h-12 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center mb-4"
              >
                <Bell className="w-6 h-6 text-[#3b82f6]" />
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="text-4xl font-extrabold text-[#333438] tracking-tight"
              >
                Notifications
              </motion.h1>
            </div>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-lg text-[#61636c] mt-2"
            >
              You have{" "}
              {unreadCount > 0 ? (
                <span className="font-semibold text-blue-600">
                  {unreadCount} unread
                </span>
              ) : (
                "no unread"
              )}{" "}
              messages.
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <button
              type="button"
              onClick={() => markAllMutation.mutate()}
              disabled={markAllMutation.isPending || unreadCount === 0}
              className="px-5 py-2.5 rounded-xl border border-gray-200 bg-white shadow-sm text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              Mark all as read
            </button>
          </motion.div>
        </div>

        {/* Notifications List */}
        <div className="space-y-4">
          {notificationsQuery.isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm animate-pulse flex gap-4"
                >
                  <div className="w-10 h-10 bg-gray-100 rounded-full shrink-0" />
                  <div className="flex-1 space-y-3 py-1">
                    <div className="h-4 bg-gray-100 rounded-md w-1/4" />
                    <div className="h-3 bg-gray-100 rounded-md w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white border border-gray-200 rounded-3xl p-16 text-center shadow-sm"
            >
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Bell className="w-8 h-8 text-gray-300" />
              </div>
              <h2 className="text-xl font-bold text-[#333438] mb-2">
                You're all caught up
              </h2>
              <p className="text-[#61636c] max-w-sm mx-auto">
                There are no new notifications. We'll alert you when there's
                activity on your projects or profile.
              </p>
            </motion.div>
          ) : (
            <AnimatePresence>
              {notifications.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                  className={`group relative bg-white rounded-2xl p-5 shadow-sm transition-all hover:shadow-md border border-transparent ${
                    item.is_read
                      ? "hover:border-gray-200"
                      : "bg-blue-50/30 border-blue-100"
                  }`}
                >
                  <div className="flex gap-4">
                    {/* Icon */}
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                        item.is_read
                          ? "bg-gray-100"
                          : "bg-white shadow-sm ring-1 ring-blue-100"
                      }`}
                    >
                      {getNotificationIcon(item)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-1">
                        <h2
                          className={`text-base font-semibold truncate ${item.is_read ? "text-gray-900" : "text-blue-900"}`}
                        >
                          {getNotificationTitle(item)}
                        </h2>
                        {!item.is_read && (
                          <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-2 shadow-sm shadow-blue-500/50" />
                        )}
                      </div>

                      <p className="text-sm text-[#61636c] leading-relaxed mb-3">
                        {getNotificationBody(item)}
                      </p>

                      <p className="text-xs font-medium text-gray-400">
                        {new Date(item.created_at).toLocaleDateString(
                          undefined,
                          {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          },
                        )}
                      </p>
                    </div>

                    {/* Actions Overlay (Desktop) / Persistent (Mobile) */}
                    <div className="md:opacity-0 group-hover:opacity-100 transition-opacity flex flex-col sm:flex-row gap-2 self-start shrink-0">
                      {!item.is_read && (
                        <button
                          type="button"
                          onClick={() => markReadMutation.mutate(item.id)}
                          disabled={markReadMutation.isPending}
                          className="p-2 sm:px-3 sm:py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 transition-colors shadow-sm"
                          title="Mark as read"
                        >
                          <Check className="w-4 h-4 sm:hidden" />
                          <span className="hidden sm:inline">Mark read</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeMutation.mutate(item.id)}
                        disabled={removeMutation.isPending}
                        className="p-2 sm:px-3 sm:py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors shadow-sm"
                        title="Remove notification"
                      >
                        <Trash2 className="w-4 h-4 sm:hidden" />
                        <span className="hidden sm:inline">Remove</span>
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}
