import { Hash, MessageCircle, Users, UserRoundSearch } from "lucide-react";
import { ChatAvatar } from "./Avatar";

export function ChatHeader({
  title,
  subtitle,
  isChannel,
  avatarUrl,
  isProfilePanelOpen,
  onToggleProfilePanel,
  onOpenSidebar,
  onManageMembers,
}: {
  title: string;
  subtitle: string;
  isChannel: boolean;
  avatarUrl?: string | null;
  isProfilePanelOpen?: boolean;
  onToggleProfilePanel?: () => void;
  onOpenSidebar?: () => void;
  /** When provided, shows a "manage members" button (gated by the caller). */
  onManageMembers?: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:px-6 md:py-4">
      <div className="flex items-center gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 md:hidden"
          aria-label="Open conversations"
        >
          <MessageCircle className="w-4 h-4" />
        </button>

        {isChannel ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
            <Hash className="w-5 h-5" />
          </div>
        ) : (
          <ChatAvatar name={title} avatarUrl={avatarUrl} size="lg" />
        )}

        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {subtitle}
          </p>
          <h2 className="truncate text-lg font-semibold text-slate-900">{title}</h2>
        </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onManageMembers && (
            <button
              type="button"
              onClick={onManageMembers}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100"
              aria-label="Manage channel members"
            >
              <Users className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onToggleProfilePanel}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
              isProfilePanelOpen
                ? "border-slate-700 bg-slate-900 text-white"
                : "border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
            aria-label={isProfilePanelOpen ? "Hide member panel" : "Show member panel"}
          >
            <UserRoundSearch className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
