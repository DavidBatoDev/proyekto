import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { projectService } from "@/services/project.service";
import { profileService } from "@/services/profile.service";
import { useAuthStore } from "@/stores/authStore";
import { ModalPortal } from "@/components/common/ModalPortal";

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  inviteeId: string;
  inviteeName: string;
}

export function InviteModal({
  open,
  onClose,
  inviteeId,
  inviteeName,
}: InviteModalProps) {
  const { user } = useAuthStore();
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["invite-projects"],
    queryFn: () => projectService.list(),
    enabled: open,
  });

  const projects = (projectsQuery.data || []).filter(
    (project) => project.consultant_id === user?.id,
  );

  useEffect(() => {
    if (!open) {
      setSelectedProjectId("");
      setMessage("");
      setErrorMessage(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || selectedProjectId || !projects.length) return;
    setSelectedProjectId(projects[0].id);
  }, [open, selectedProjectId, projects]);

  const inviteMutation = useMutation({
    mutationFn: () =>
      profileService.inviteFreelancer({
        projectId: selectedProjectId,
        inviteeId,
        message: message.trim() || undefined,
      }),
    onSuccess: () => {
      onClose();
    },
    onError: (error: unknown) => {
      const msg =
        error instanceof Error ? error.message : "Failed to send invite.";
      setErrorMessage(msg);
    },
  });

  if (!open) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Invite to Project
            </h3>
            <p className="text-sm text-gray-500">
              Send an invite to {inviteeName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Select project
            </label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff9933]/50"
            >
              {projects.length === 0 && (
                <option value="">No assigned consultant projects</option>
              )}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Message (optional)
            </label>
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Share context about the role and why you're inviting this freelancer..."
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff9933]/50"
            />
          </div>

          {errorMessage && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              inviteMutation.isPending ||
              projectsQuery.isLoading ||
              !selectedProjectId
            }
            onClick={() => {
              setErrorMessage(null);
              inviteMutation.mutate();
            }}
            className="px-4 py-2 text-sm rounded-xl bg-[#ff9933] text-white font-medium hover:bg-[#f28a22] disabled:opacity-60"
          >
            {inviteMutation.isPending ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Sending...
              </span>
            ) : (
              "Send Invite"
            )}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
