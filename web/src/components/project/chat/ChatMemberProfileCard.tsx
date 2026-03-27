import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { ChatAvatar } from "./Avatar";

export type ChatMemberProfilePreview = {
  userId: string;
  name: string;
  roleLabel: string;
  positionLabel: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
};

export function ChatMemberProfileCard({
  member,
}: {
  member: ChatMemberProfilePreview | null;
}) {
  if (!member) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <p className="text-sm text-gray-500 text-center">
          Select a sender in this thread to view their profile.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="relative px-4 pt-4">
        <div className="h-28 rounded-2xl overflow-hidden bg-gradient-to-r from-orange-200 via-amber-200 to-orange-100 border border-orange-100">
          {member.bannerUrl ? (
            <img
              src={member.bannerUrl}
              alt={`${member.name} banner`}
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="absolute left-8 -bottom-8 ring-4 ring-[#f5f6f8] rounded-full">
          <ChatAvatar name={member.name} avatarUrl={member.avatarUrl} size="lg" />
        </div>
      </div>

      <div className="px-4 pt-10">
        <h3 className="text-2xl font-semibold text-gray-900 truncate">{member.name}</h3>
        <p className="mt-1 text-sm text-gray-500">{member.roleLabel}</p>
      </div>

      <div className="px-4 mt-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold">
            Position In Project
          </p>
          <p className="mt-2 text-sm text-gray-900">{member.positionLabel}</p>
        </div>
      </div>

      <div className="mt-auto px-4 pb-4">
        <Link
          to="/profile/$profileId"
          params={{ profileId: member.userId }}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff9933] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#e68829]"
        >
          View Full Profile
          <ExternalLink className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
