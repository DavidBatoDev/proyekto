import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, Loader2, ShieldCheck, Briefcase } from "lucide-react";
import { switchPersona } from "@/lib/auth-api";
import { extractApiErrorMessage } from "@/lib/permissionErrors";
import type { FullProfile } from "@/services/profile.service";
import type { Profile, PersonaType } from "@/types/profile.types";

interface Props {
  profile: FullProfile;
  isOwner: boolean;
  onSwitch: (updated: Profile) => void;
}

const PERSONA_LABELS: Record<string, string> = {
  consultant: "Consultant",
  freelancer: "Freelancer",
  client: "Client",
  admin: "Admin",
};

const PERSONA_BADGE: Record<string, string> = {
  consultant:
    "bg-teal-50 text-teal-700 border border-teal-300",
  freelancer:
    "bg-orange-50 text-orange-600 border border-orange-300",
  client:
    "bg-gray-100 text-gray-600 border border-gray-300",
  admin:
    "bg-purple-50 text-purple-700 border border-purple-300",
};

export function AccountTypeSection({ profile, isOwner, onSwitch }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = profile.active_persona;
  const isConsultantVerified = profile.is_consultant_verified;

  // Determine what target persona to offer
  const targetPersona: PersonaType | null =
    current === "consultant"
      ? "freelancer"
      : current === "freelancer"
        ? "consultant"
        : null;

  const canSwitch =
    targetPersona === "freelancer" ||
    (targetPersona === "consultant" && isConsultantVerified);

  const handleSwitch = async () => {
    if (!targetPersona) return;
    setLoading(true);
    setError(null);
    setConfirming(false);
    try {
      const { data } = await switchPersona(targetPersona);
      onSwitch(data);
    } catch (err: any) {
      const msg = extractApiErrorMessage(
        err?.response?.data,
        err?.message ?? "Switch failed. Please try again.",
      );
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!isOwner || current === "client" || current === "admin") return null;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <ArrowLeftRight className="w-5 h-5 text-gray-900" strokeWidth={2.5} />
        <h2 className="text-lg font-bold text-gray-900">Account Type</h2>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${PERSONA_BADGE[current] ?? PERSONA_BADGE.client}`}
          >
            {current === "consultant" ? (
              <ShieldCheck className="w-3.5 h-3.5" />
            ) : (
              <Briefcase className="w-3.5 h-3.5" />
            )}
            {PERSONA_LABELS[current] ?? current}
          </span>
          <span className="text-sm text-gray-500">Current account type</span>
        </div>

        {targetPersona && (
          <div className="flex flex-col items-start sm:items-end gap-2">
            {canSwitch ? (
              confirming ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">
                    Switch to{" "}
                    <strong>{PERSONA_LABELS[targetPersona]}</strong>? Your projects and data stay intact.
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="text-sm text-gray-500 hover:text-gray-700 underline"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSwitch}
                    disabled={loading}
                    className="flex items-center gap-1.5 text-sm font-semibold bg-gray-900 text-white px-4 py-1.5 rounded-full hover:bg-gray-800 disabled:opacity-60 transition-colors"
                  >
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Confirm
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={loading}
                  className="flex items-center gap-1.5 text-sm font-semibold border border-gray-300 text-gray-700 px-4 py-1.5 rounded-full hover:bg-gray-50 disabled:opacity-60 transition-colors"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  Switch to {PERSONA_LABELS[targetPersona]}
                </button>
              )
            ) : (
              /* freelancer who isn't verified — offer apply path */
              <Link
                to="/consultant/apply"
                className="flex items-center gap-1.5 text-sm font-semibold bg-teal-50 border border-teal-400 text-teal-600 px-4 py-1.5 rounded-full hover:bg-teal-100 transition-colors"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Apply as Consultant
              </Link>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-sm text-red-600">{error}</p>
          {targetPersona === "freelancer" && (
            <Link
              to="/freelancer/go-live"
              className="mt-1.5 inline-block text-sm font-semibold text-[#ff9933] hover:underline"
            >
              Complete freelancer profile →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
