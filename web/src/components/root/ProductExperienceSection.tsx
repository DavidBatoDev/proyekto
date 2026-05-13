import type { ComponentType } from "react";
import {
  Bell,
  BellRing,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileCheck2,
  FileText,
  FolderOpen,
  Gauge,
  LayoutDashboard,
  ListTodo,
  Map,
  MessageCircle,
  Route,
  Settings,
  Share2,
  ShieldAlert,
  Store,
  Target,
  UserRoundSearch,
  Users,
  UsersRound,
  Workflow,
} from "lucide-react";

const coreFeatures = [
  {
    title: "Roadmap Studio",
    copy:
      "Convert a raw concept into milestones, dependencies, and execution lanes your whole team can align around.",
    chips: ["Milestone sequencing", "Risk flags", "Owner mapping"],
    tone: "from-blue-50 to-cyan-50",
  },
  {
    title: "Task Flow",
    copy:
      "Every milestone creates actionable workstreams, handoffs, and progress tracking across consultants and freelancers.",
    chips: ["Task readiness", "Delivery health", "Automated updates"],
    tone: "from-indigo-50 to-blue-50",
  },
  {
    title: "Expert Matching",
    copy:
      "Get consultant recommendations first, then staff the execution layer with freelancers tailored to project phase and domain.",
    chips: ["Skill scoring", "Budget-aware", "Execution-fit ranking"],
    tone: "from-sky-50 to-indigo-50",
  },
];

const topRowTiles = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Project Posting", icon: FileText },
  { label: "Roadmap Views", icon: Map },
  { label: "Work Items", icon: ListTodo },
  { label: "Team Management", icon: UsersRound },
  { label: "Project Chat", icon: MessageCircle },
  { label: "Notifications", icon: Bell },
  { label: "Consultant Marketplace", icon: Store },
  { label: "Consultant Browse", icon: UserRoundSearch },
  { label: "Freelancer Invites", icon: Users },
  { label: "Template Roadmaps", icon: FileCheck2 },
  { label: "Shared With Me", icon: Share2 },
];

const middleSideLeftTiles = [
  { label: "Time Logs", icon: Clock3 },
  { label: "Team Logs", icon: Clock3 },
  { label: "Payments", icon: CreditCard },
  { label: "Project Logs", icon: FileText },
  { label: "Project Overview", icon: LayoutDashboard },
  { label: "Roadmap Create", icon: Workflow },
  { label: "Roadmap Share", icon: Share2 },
  { label: "Resource Hub", icon: FolderOpen },
  { label: "Project Settings", icon: Settings },
  { label: "Team Settings", icon: Settings },
  { label: "Profile", icon: Users },
  { label: "Shared Roadmap Link", icon: Share2 },
];

const middleSideRightTiles = [
  { label: "Consultant Apply", icon: BriefcaseBusiness },
  { label: "Freelancer Go Live", icon: UsersRound },
  { label: "Consultant Templates", icon: FileCheck2 },
  { label: "Admin Applications", icon: FileText },
  { label: "Admin Match", icon: Target },
  { label: "Admin Settings", icon: Settings },
  { label: "Onboarding", icon: CheckCircle2 },
  { label: "Project Team", icon: UsersRound },
  { label: "Project Resources", icon: FolderOpen },
  { label: "Roadmap Editor", icon: Map },
  { label: "Task Boards", icon: ListTodo },
  { label: "Project Payments", icon: CreditCard },
];

const bottomRowTiles = [
  { label: "Milestone sequencing", icon: Route },
  { label: "Risk flags", icon: ShieldAlert },
  { label: "Owner mapping", icon: Users },
  { label: "Task readiness", icon: CheckCircle2 },
  { label: "Delivery health", icon: Gauge },
  { label: "Automated updates", icon: BellRing },
  { label: "Dependencies", icon: Workflow },
  { label: "Milestone tracking", icon: Target },
  { label: "Skill scoring", icon: Target },
  { label: "Budget-aware", icon: BriefcaseBusiness },
  { label: "Execution-fit ranking", icon: UsersRound },
  { label: "Timeline visibility", icon: Clock3 },
];

function SmallFeatureTile({
  label,
  Icon,
  className,
}: {
  label: string;
  Icon: ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div
      className={`group relative bg-white/80 px-2 py-3 text-center shadow-[inset_0_0_0_1px_rgba(59,130,246,0.12)] transition-all duration-200 hover:z-10 hover:bg-white hover:shadow-[inset_0_0_0_1px_rgba(59,130,246,0.36),0_4px_16px_rgba(37,99,235,0.10)] ${className ?? ""}`}
    >
      {/* Blue top accent bar — slides in on hover */}
      <span className="absolute inset-x-0 top-0 h-0.5 scale-x-0 bg-blue-500 transition-transform duration-200 group-hover:scale-x-100" />
      <Icon className="mx-auto h-4 w-4 text-slate-400 transition-colors duration-200 group-hover:text-blue-500" />
      <p className="mt-1.5 text-[11px] font-medium leading-tight text-slate-600 transition-colors duration-200 group-hover:text-slate-900">{label}</p>
    </div>
  );
}

export function ProductExperienceSection({ isActive: _isActive }: { isActive?: boolean } = {}) {
  return (
    <section id="features" className="relative flex flex-col h-full py-4 overflow-hidden">
      <div className="text-center shrink-0">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Proyekto Features</p>
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Everything you need in one place
        </h2>
        <p className="mx-auto mt-2 max-w-3xl text-sm text-slate-600 sm:text-base">
          100+ features to plan, execute, and stay aligned — without switching tools.
        </p>
      </div>

      <div className="relative mt-6 presentation-inner-scroll flex-1" style={{ maxHeight: "calc(100vh - 260px)" }}>
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-36 bg-[linear-gradient(to_right,rgba(255,255,255,0.5)_1px,transparent_1px),linear-gradient(to_bottom,rgba(59,130,246,0.12)_1px,transparent_1px)] bg-[size:100%_92px]" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-36 bg-[linear-gradient(to_right,rgba(255,255,255,0.5)_1px,transparent_1px),linear-gradient(to_bottom,rgba(59,130,246,0.12)_1px,transparent_1px)] bg-[size:100%_92px]" />
        <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-44 bg-linear-to-r from-[#fcfcfd] via-[#fcfcfd]/84 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-44 bg-linear-to-l from-[#fcfcfd] via-[#fcfcfd]/84 to-transparent" />

        <div className="relative grid md:grid-cols-12">
          {topRowTiles.map((tile) => (
            <SmallFeatureTile key={tile.label} label={tile.label} Icon={tile.icon} />
          ))}
        </div>

        <div className="relative mt-px grid md:grid-cols-12">
          <div className="grid md:col-span-3 md:auto-rows-[104px] md:grid-cols-3">
            {middleSideLeftTiles.map((tile) => (
              <SmallFeatureTile
                key={tile.label}
                label={tile.label}
                Icon={tile.icon}
                className="md:min-h-[104px]"
              />
            ))}
          </div>

          {coreFeatures.map((feature) => (
            <div
              key={feature.title}
              className={`group relative flex flex-col justify-center overflow-hidden bg-linear-to-br ${feature.tone} p-5 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.14)] transition-shadow duration-300 hover:shadow-[inset_0_0_0_1px_rgba(59,130,246,0.32),0_8px_32px_rgba(37,99,235,0.10)] md:col-span-2 md:min-h-80`}
            >
              {/* Left accent bar */}
              <span className="absolute inset-y-0 left-0 w-0.5 origin-top scale-y-0 bg-blue-500 transition-transform duration-300 group-hover:scale-y-100" />
              <h3 className="text-2xl font-semibold tracking-tight text-slate-900">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{feature.copy}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {feature.chips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-blue-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors duration-150 group-hover:border-blue-400 group-hover:bg-white group-hover:text-blue-700"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          ))}

          <div className="grid md:col-span-3 md:auto-rows-[104px] md:grid-cols-3">
            {middleSideRightTiles.map((tile) => (
              <SmallFeatureTile
                key={tile.label}
                label={tile.label}
                Icon={tile.icon}
                className="md:min-h-[104px]"
              />
            ))}
          </div>
        </div>

        <div className="relative mt-px grid md:grid-cols-12">
          {bottomRowTiles.map((tile) => (
            <SmallFeatureTile key={tile.label} label={tile.label} Icon={tile.icon} />
          ))}
        </div>
      </div>
    </section>
  );
}
