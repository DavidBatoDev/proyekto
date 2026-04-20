import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AppSurfaceCardProps {
  children: ReactNode;
  className?: string;
  strong?: boolean;
}

export function AppSurfaceCard({
  children,
  className,
  strong = false,
}: AppSurfaceCardProps) {
  return (
    <section
      className={cn(
        strong ? "app-surface-card-strong" : "app-surface-card",
        "app-motion-safe",
        className,
      )}
    >
      {children}
    </section>
  );
}

interface AppSectionHeaderProps {
  title: string;
  subtitle?: string;
  kicker?: string;
  rightSlot?: ReactNode;
  className?: string;
}

export function AppSectionHeader({
  title,
  subtitle,
  kicker,
  rightSlot,
  className,
}: AppSectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div>
        {kicker ? <p className="app-section-kicker">{kicker}</p> : null}
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 max-w-2xl text-sm text-slate-600">{subtitle}</p>
        ) : null}
      </div>
      {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
    </div>
  );
}

interface AppStatCardProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  onClick?: () => void;
  loading?: boolean;
  className?: string;
}

export function AppStatCard({
  label,
  value,
  icon: Icon,
  onClick,
  loading = false,
  className,
}: AppStatCardProps) {
  const Root = onClick ? "button" : "div";

  return (
    <Root
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all",
        onClick ? "hover:-translate-y-0.5 hover:shadow-md cursor-pointer" : "",
        className,
      )}
    >
      <span className="pointer-events-none absolute -top-16 -right-12 h-28 w-28 rounded-full bg-slate-200/45 blur-2xl" />
      <div className="relative z-10 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          {label}
        </p>
        <span className="inline-flex items-center gap-2 text-slate-400">
          {Icon ? <Icon className="h-4 w-4" /> : null}
          {onClick ? <ArrowRight className="h-4 w-4" /> : null}
        </span>
      </div>
      <p className="relative z-10 mt-2 text-3xl font-semibold text-slate-900">
        {loading ? "..." : value}
      </p>
    </Root>
  );
}

interface AppEmptyStateProps {
  title: string;
  description: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}

export function AppEmptyState({
  title,
  description,
  icon: Icon,
  action,
  className,
}: AppEmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm",
        className,
      )}
    >
      {Icon ? (
        <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600">
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mx-auto mt-1 max-w-xl text-sm text-slate-600">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

interface AppNavPillProps {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function AppNavPill({
  active = false,
  children,
  onClick,
  className,
}: AppNavPillProps) {
  const Root = onClick ? "button" : "span";

  return (
    <Root
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-sm font-semibold transition-all",
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:border-slate-900 hover:text-slate-900",
        className,
      )}
    >
      {children}
    </Root>
  );
}
