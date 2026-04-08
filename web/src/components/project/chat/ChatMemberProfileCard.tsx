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
        <p className="text-center text-sm text-slate-500">
          Select a sender in this thread to view their profile.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="relative px-4 pt-4">
        <div className="h-28 overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-200 via-slate-100 to-slate-50">
          {member.bannerUrl ? (
            <img
              src={member.bannerUrl}
              alt={`${member.name} banner`}
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="absolute -bottom-8 left-8 rounded-full ring-4 ring-slate-50">
          <ChatAvatar name={member.name} avatarUrl={member.avatarUrl} size="lg" />
        </div>
      </div>

      <div className="px-4 pt-10">
        <h3 className="truncate text-2xl font-semibold text-slate-900">{member.name}</h3>
        <p className="mt-1 text-sm text-slate-500">{member.roleLabel}</p>
      </div>

      <div className="px-4 mt-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Position In Project
          </p>
          <p className="mt-2 text-sm text-slate-900">{member.positionLabel}</p>
        </div>
      </div>

      <div className="mt-auto px-4 pb-4">
        <Link
          to="/profile/$profileId"
          params={{ profileId: member.userId }}
          className="app-cta inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
        >
          View Full Profile
          <ExternalLink className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
