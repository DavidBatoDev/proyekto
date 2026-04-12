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
      className={`bg-white/80 px-3 py-6 text-center shadow-[inset_0_0_0_1px_rgba(59,130,246,0.14)] transition-all duration-200 hover:bg-white hover:shadow-[inset_0_0_0_1px_rgba(59,130,246,0.42)] ${className ?? ""}`}
    >
      <Icon className="mx-auto h-5 w-5 text-slate-500" />
      <p className="mt-2 text-sm font-medium text-slate-700">{label}</p>
    </div>
  );
}

export function ProductExperienceSection() {
  return (
    <section id="features" className="relative mt-16 lg:mt-20">
      <div className="text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Proyekto Feature
        </h2>
        <p className="mx-auto mt-3 max-w-3xl text-sm text-slate-600 sm:text-base">
          Plan, execute, and run delivery with roadmap, collaboration, operations, and marketplace tools in one connected system.
        </p>
      </div>

      <div className="relative mt-10 overflow-hidden">
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
              className={`flex flex-col justify-center bg-linear-to-br ${feature.tone} p-5 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.14)] md:col-span-2 md:min-h-[416px]`}
            >
              <h3 className="text-2xl font-semibold tracking-tight text-slate-900">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">{feature.copy}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {feature.chips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-blue-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-700"
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
