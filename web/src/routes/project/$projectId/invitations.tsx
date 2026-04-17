import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Users,
  UserCheck,
  Loader2,
  Link2,
  InboxIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useAuthStore } from "@/stores/authStore";
import { useProjectDetailQuery } from "@/hooks/useProjectQueries";
import { useToast } from "@/hooks/useToast";
import {
  getInvitationRequests,
  reviewInvitationRequest,
  ROLE_META,
  type InvitationRequest,
  type InvitationRequestStatus,
  type InvitationRoleType,
} from "@/services/project-invitations.service";

export const Route = createFileRoute("/project/$projectId/invitations")({
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated) {
      throw redirect({ to: "/auth/login" });
    }
  },
  component: InvitationsPage,
});

const ROLE_ICONS: Record<InvitationRoleType, React.ElementType> = {
  consultant: ShieldCheck,
  freelancer: Users,
  client: UserCheck,
};

type FilterTab = InvitationRequestStatus;

const TABS: { value: FilterTab; label: string; icon: React.ElementType }[] = [
  { value: "pending", label: "Pending", icon: Clock },
  { value: "approved", label: "Approved", icon: CheckCircle2 },
  { value: "rejected", label: "Rejected", icon: XCircle },
];

function RequesterAvatar({ requester }: { requester: InvitationRequest["requester"] }) {
  const name = requester?.display_name ?? requester?.first_name ?? requester?.email ?? "?";
  if (requester?.avatar_url) {
    return (
      <img
        src={requester.avatar_url}
        alt={name}
        className="h-10 w-10 rounded-full object-cover ring-2 ring-white"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br from-gray-200 to-gray-300 text-sm font-semibold text-gray-600 ring-2 ring-white">
      {name[0]?.toUpperCase()}
    </div>
  );
}

function RequestCard({
  request,
  onApprove,
  onReject,
  isActing,
}: {
  request: InvitationRequest;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isActing: boolean;
}) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const meta = ROLE_META[request.role_requested];
  const Icon = ROLE_ICONS[request.role_requested];
  const requester = request.requester;
  const displayName =
    requester?.display_name ||
    [requester?.first_name, requester?.last_name].filter(Boolean).join(" ") ||
    requester?.email ||
    "Unknown";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <RequesterAvatar requester={requester} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-900">{displayName}</p>
              {requester?.email && (
                <p className="text-xs text-gray-400">{requester.email}</p>
              )}
            </div>
            <span
              className={`flex shrink-0 items-center gap-1.5 rounded-full bg-linear-to-r ${meta.gradient} px-2.5 py-1 text-xs font-semibold ${meta.color}`}
            >
              <Icon size={11} />
              {meta.label}
            </span>
          </div>

          {request.note && (
            <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600 italic">
              "{request.note}"
            </div>
          )}

          <p className="mt-1.5 text-xs text-gray-400">
            {formatDistanceToNow(new Date(request.created_at), { addSuffix: true })}
          </p>

          {/* Rejection reason (for rejected tab) */}
          {request.status === "rejected" && request.rejection_reason && (
            <div className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
              Reason: {request.rejection_reason}
            </div>
          )}

          {/* Actions for pending */}
          {request.status === "pending" && (
            <div className="mt-3">
              {!showRejectInput ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => onApprove(request.id)}
                    disabled={isActing}
                    className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:opacity-60"
                  >
                    {isActing ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={12} />
                    )}
                    Approve
                  </button>
                  <button
                    onClick={() => setShowRejectInput(true)}
                    disabled={isActing}
                    className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-60"
                  >
                    <XCircle size={12} />
                    Reject
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Reason for rejection (optional)"
                    className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:border-red-300 focus:outline-none focus:ring-1 focus:ring-red-300"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        onReject(request.id);
                        setShowRejectInput(false);
                      }}
                      disabled={isActing}
                      className="flex items-center gap-1.5 rounded-xl bg-red-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-60"
                    >
                      {isActing ? <Loader2 size={12} className="animate-spin" /> : null}
                      Confirm Reject
                    </button>
                    <button
                      onClick={() => setShowRejectInput(false)}
                      className="rounded-xl border border-gray-200 px-4 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function EmptyState({ status }: { status: FilterTab }) {
  const messages: Record<FilterTab, { icon: React.ElementType; title: string; body: string }> = {
    pending: {
      icon: InboxIcon,
      title: "No pending requests",
      body: "Share your invitation links to start receiving access requests.",
    },
    approved: {
      icon: CheckCircle2,
      title: "No approved requests yet",
      body: "Approved members will appear here.",
    },
    rejected: {
      icon: XCircle,
      title: "No rejected requests",
      body: "Declined requests will appear here.",
    },
  };
  const { icon: Icon, title, body } = messages[status];
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Icon size={36} className="text-gray-300" />
      <p className="mt-3 text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-1 text-xs text-gray-400">{body}</p>
    </div>
  );
}

function InvitationsPage() {
  const { projectId } = Route.useParams();
  const { profile } = useAuthStore();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<FilterTab>("pending");
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  const projectQuery = useProjectDetailQuery(projectId);
  const project = projectQuery.data ?? null;
  const isConsultant = project?.consultant_id === profile?.id;

  const requestsQuery = useQuery({
    queryKey: ["project-invitation-requests", projectId, activeTab],
    queryFn: () => getInvitationRequests(projectId, activeTab),
    enabled: !!projectId && isConsultant,
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      requestId,
      status,
      rejectionReason,
    }: {
      requestId: string;
      status: "approved" | "rejected";
      rejectionReason?: string;
    }) => reviewInvitationRequest(requestId, status, rejectionReason),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["project-invitation-requests", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-invitation-links", projectId] });
      toast.success(variables.status === "approved" ? "Request approved — member added!" : "Request rejected");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to review request");
    },
    onSettled: () => setActingId(null),
  });

  const handleApprove = (requestId: string) => {
    setActingId(requestId);
    reviewMutation.mutate({ requestId, status: "approved" });
  };

  const handleReject = (requestId: string) => {
    setActingId(requestId);
    reviewMutation.mutate({
      requestId,
      status: "rejected",
      rejectionReason: rejectReasons[requestId],
    });
    setRejectReasons((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
  };

  const requests = requestsQuery.data ?? [];

  const tabCounts = useQuery({
    queryKey: ["project-invitation-requests", projectId, "all-counts"],
    queryFn: async () => {
      const all = await getInvitationRequests(projectId);
      return {
        pending: all.filter((r) => r.status === "pending").length,
        approved: all.filter((r) => r.status === "approved").length,
        rejected: all.filter((r) => r.status === "rejected").length,
      };
    },
    enabled: !!projectId && isConsultant,
  });

  if (projectQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (!isConsultant) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <ShieldCheck size={36} className="mx-auto text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">Only the project consultant can manage invitations.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f7f8]">
      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
            <Link2 size={12} />
            <span>{project?.title ?? "Project"}</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Invitation Requests</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review and manage access requests from people who used your invitation links.
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
          {TABS.map(({ value, label, icon: Icon }) => {
            const count = tabCounts.data?.[value] ?? 0;
            return (
              <button
                key={value}
                onClick={() => setActiveTab(value)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                  activeTab === value
                    ? "bg-[#ff9933] text-white shadow"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                }`}
              >
                <Icon size={13} />
                {label}
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      activeTab === value ? "bg-white/30 text-white" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Request list */}
        {requestsQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : requests.length === 0 ? (
          <EmptyState status={activeTab} />
        ) : (
          <AnimatePresence mode="popLayout">
            <div className="space-y-3">
              {requests.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  isActing={actingId === request.id}
                />
              ))}
            </div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
