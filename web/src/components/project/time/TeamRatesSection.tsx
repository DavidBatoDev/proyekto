import { Loader2, Plus } from "lucide-react";
import type { ProjectMemberTimeRate } from "@/services/project-time.service";
import { initialsFromName } from "./time-utils";

function formatRateDate(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed);
}

function RateCardSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden animate-pulse">
      <div className="h-16 bg-gray-100" />
      <div className="px-4 pb-4 -mt-8">
        <div className="mx-auto h-16 w-16 rounded-full border-4 border-white bg-gray-200" />
        <div className="mt-3 space-y-2 text-center">
          <div className="mx-auto h-4 w-32 rounded bg-gray-200" />
          <div className="mx-auto h-3 w-40 rounded bg-gray-100" />
          <div className="mx-auto h-7 w-24 rounded-full bg-gray-100" />
        </div>
      </div>
    </div>
  );
}

interface TeamRatesSectionProps {
  rates: ProjectMemberTimeRate[];
  loadingRates: boolean;
  canManageRates: boolean;
  pendingRateById: Record<string, boolean>;
  onViewLogs: (rate: ProjectMemberTimeRate) => void;
  onOpenAddRate: () => void;
  onOpenEditRate: (rate: ProjectMemberTimeRate) => void;
}

export function TeamRatesSection({
  rates,
  loadingRates,
  canManageRates,
  pendingRateById,
  onViewLogs,
  onOpenAddRate,
  onOpenEditRate,
}: TeamRatesSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Project Member Time Rates</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Members need a rate row here before they can use time tracking.
          </p>
        </div>
        {canManageRates && (
          <button
            type="button"
            onClick={onOpenAddRate}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Rate
          </button>
        )}
      </div>

      <div className="space-y-3">
        {loadingRates ? (
          <div className="flex flex-wrap gap-4">
            <RateCardSkeleton />
            <RateCardSkeleton />
            <RateCardSkeleton />
          </div>
        ) : rates.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center">
            <p className="text-sm text-gray-500">No time rates set yet.</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-4">
            {rates.map((rate) => {
              const isPending = Boolean(pendingRateById[rate.id]);
              const memberName =
                rate.member?.display_name || rate.member?.email || rate.member_user_id;
              const roleRaw = rate.project_member?.role || "member";
              const roleLabel = roleRaw.charAt(0).toUpperCase() + roleRaw.slice(1);
              const positionLabel =
                (rate.project_member?.position || "").trim() || "Project Member";
              const avatarUrl = rate.member?.avatar_url;
              const bannerUrl = rate.member?.banner_url;

              return (
                <div
                  key={rate.id}
                  className={`w-full sm:w-[240px] rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden min-h-[280px] flex flex-col ${
                    isPending ? "ring-1 ring-amber-300/60 bg-amber-50/20" : ""
                  }`}
                >
                  <div
                    className="h-14 bg-gradient-to-r from-slate-200 via-slate-100 to-slate-50"
                    style={
                      bannerUrl
                        ? {
                            backgroundImage: `url(${bannerUrl})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }
                        : undefined
                    }
                  />
                  <div className="px-3 pb-3 -mt-7 flex-1 flex flex-col">
                    <div className="mx-auto h-14 w-14 rounded-full border-4 border-white bg-white shadow-sm overflow-hidden flex items-center justify-center">
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt={memberName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-xs font-semibold text-gray-700">
                          {initialsFromName(memberName)}
                        </span>
                      )}
                    </div>

                    <div className="mt-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <p className="text-sm font-semibold text-gray-900 leading-tight">
                          {memberName}
                        </p>
                        {isPending && (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin text-slate-700"
                            aria-label="Rate pending"
                          />
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1">
                        {roleLabel} | {positionLabel}
                      </p>
                    </div>

                    <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/70 p-2">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-gray-500">Custom ID</span>
                        <span className="font-medium text-gray-700 text-right break-all">
                          {rate.custom_id?.trim() || "-"}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-gray-500">Start Date</span>
                        <span className="font-medium text-gray-700 text-right">
                          {formatRateDate(rate.start_date)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-gray-500">End Date</span>
                        <span className="font-medium text-gray-700 text-right">
                          {formatRateDate(rate.end_date)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-gray-500">Hourly Rate</span>
                        <span className="font-semibold text-slate-700 text-right">
                          {Number(rate.hourly_rate).toFixed(2)} {rate.currency}
                        </span>
                      </div>
                    </div>

                    <div className="mt-auto pt-3 border-t border-gray-100">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => onViewLogs(rate)}
                          disabled={isPending}
                          className="px-2.5 py-1 text-xs font-semibold rounded-md border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          View Logs
                        </button>
                        {canManageRates && (
                          <button
                            type="button"
                            onClick={() => onOpenEditRate(rate)}
                            disabled={isPending}
                            className="px-2.5 py-1 text-xs font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

