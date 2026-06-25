import { Calendar, User } from "lucide-react";
import type { ProjectMember } from "@/services/project.service";
import type { OverviewTimelineItem } from "./types";
import { milestoneState, nameFromMember, MAX_OVERVIEW_MILESTONES } from "./utils";

interface OverviewSidebarProps {
  timelineItems: OverviewTimelineItem[];
  members: ProjectMember[];
}

export function OverviewSidebar({ timelineItems, members }: OverviewSidebarProps) {
  const visibleItems = timelineItems.slice(0, MAX_OVERVIEW_MILESTONES);

  return (
    <aside className="sticky top-6 self-start space-y-4 md:pl-2 md:space-y-5">
      {/* Milestones */}
      <div className="app-surface-card p-4 md:p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900 md:mb-4 md:text-base">
          Milestones
        </h2>
        {timelineItems.length === 0 ? (
          <div className="relative pb-2 pl-11">
            <span className="absolute bottom-0 left-[15px] top-7 w-px border-l-2 border-dashed border-slate-300" />
            <span className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-slate-300 bg-slate-50/80" />
            <div className="flex flex-col pt-1.5">
              <p className="text-[13px] font-medium text-slate-600">
                No milestones yet
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Project timeline will appear here
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-0">
            {visibleItems.map((item, index) => {
              const style = milestoneState(item.status);
              const DotIcon = style.icon;
              return (
                <div key={item.id} className="relative pb-4 pl-9 last:pb-0 md:pb-5">
                  {index < visibleItems.length - 1 && (
                    <span className="absolute bottom-0 left-[15px] top-7 w-px bg-slate-200" />
                  )}
                  <span
                    className={`absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border-2 md:h-8 md:w-8 ${style.dot}`}
                  >
                    <DotIcon className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  </span>
                  <p
                    className={`text-[13px] font-semibold leading-5 md:text-[14px] ${style.title}`}
                  >
                    {item.title}
                  </p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-500 md:mt-1 md:text-[12px]">
                    <Calendar className="w-3.5 h-3.5" />
                    {new Date(item.target_date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                    <span className="uppercase tracking-wide text-[10px] text-gray-400">
                      {item.kind}
                    </span>
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Project Team */}
      <div className="app-surface-card p-4 md:p-5">
        <h2 className="mb-2.5 text-sm font-semibold text-slate-900 md:mb-3 md:text-base">
          Project Team
        </h2>
        {members.length === 0 ? (
          <p className="text-[13px] text-slate-500">No members yet.</p>
        ) : (
          <div className="flex items-center gap-2">
            {members.slice(0, 6).map((member, index) => (
              <div
                key={member.id}
                className={index > 0 ? "-ml-2" : ""}
                title={`${nameFromMember(member)} (${member.role})`}
              >
                {member.user?.avatar_url ? (
                  <img
                    src={member.user.avatar_url}
                    alt={nameFromMember(member)}
                    className="h-9 w-9 rounded-full border-2 border-white object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-xs font-bold text-slate-600">
                    <User className="w-4 h-4" />
                  </span>
                )}
              </div>
            ))}
            {members.length > 6 && (
              <span className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-xs font-semibold text-slate-600">
                +{members.length - 6}
              </span>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
