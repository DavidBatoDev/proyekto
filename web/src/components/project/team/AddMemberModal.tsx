import { useState } from "react";
import { Users, X, Plus } from "lucide-react";
import { useProjectInviteMemberMutation } from "@/hooks/useProjectQueries";

interface AddMemberModalProps {
  projectId: string;
  onClose: () => void;
}

export function AddMemberModal({ projectId, onClose }: AddMemberModalProps) {
  const [email, setEmail] = useState("");
  const [position, setPosition] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inviteMemberMutation = useProjectInviteMemberMutation(projectId);
  const saving = inviteMemberMutation.isPending;

  const submit = async () => {
    const positionVal = position.trim();
    if (!positionVal) {
      setError("Position title is required.");
      return;
    }
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    setError(null);
    try {
      await inviteMemberMutation.mutateAsync({
        email: email.trim(),
        position: positionVal,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send invite.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
              <Users className="w-4 h-4 text-gray-500" />
            </div>
            <h2 className="text-[15px] font-semibold text-gray-900">
              Add Team Member
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="member@example.com"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-500 placeholder:text-gray-300"
            />
            <p className="mt-1.5 text-[11px] text-gray-400">
              If they already have an account they'll be notified right away. If
              not, they'll get the invite after signup.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              Position / Title
            </label>
            <input
              type="text"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="e.g. Backend Developer"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-500 placeholder:text-gray-300"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2.5 border border-red-100">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/60">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 shadow-sm shadow-slate-900/20"
          >
            {saving ? (
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            Add Member
          </button>
        </div>
      </div>
    </div>
  );
}

