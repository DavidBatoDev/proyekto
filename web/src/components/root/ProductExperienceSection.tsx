import {
  Workflow,
  ListChecks,
  UserRoundSearch,
  Flag,
  ShieldAlert,
  Users,
  Gauge,
  BellRing,
  Target,
  Route,
  CheckCircle2,
  BriefcaseBusiness,
  Network,
  Clock3,
  GitBranchPlus,
  LayoutDashboard,
  FileText,
  Map,
  UsersRound,
  MessageCircle,
  CreditCard,
  FolderOpen,
  Store,
  Share2,
  ListTodo,
  Bell,
} from "lucide-react";

const coreFeatures = [
  {
    title: "Roadmap Studio",
    copy:
      "Convert a raw concept into milestones, dependencies, and execution lanes your whole team can align around.",
    chips: ["Milestone sequencing", "Risk flags", "Owner mapping"],
    icon: Workflow,
    tone: "from-blue-50 to-cyan-50",
  },
  {
    title: "Task Flow",
    copy:
      "Every milestone creates actionable workstreams, handoffs, and progress tracking across consultants and freelancers.",
    chips: ["Task readiness", "Delivery health", "Automated updates"],
    icon: ListChecks,
    tone: "from-indigo-50 to-blue-50",
  },
  {
    title: "Expert Matching",
    copy:
      "Get consultant recommendations first, then staff the execution layer with freelancers tailored to project phase and domain.",
    chips: ["Skill scoring", "Budget-aware", "Execution-fit ranking"],
    icon: UserRoundSearch,
    tone: "from-sky-50 to-indigo-50",
  },
];

const topTiles = [
  { label: "Milestone sequencing", icon: Route },
  { label: "Risk flags", icon: ShieldAlert },
  { label: "Owner mapping", icon: Users },
  { label: "Task readiness", icon: CheckCircle2 },
  { label: "Delivery health", icon: Gauge },
  { label: "Automated updates", icon: BellRing },
];

const bottomTiles = [
  { label: "Skill scoring", icon: Target },
  { label: "Budget-aware", icon: BriefcaseBusiness },
  { label: "Execution-fit ranking", icon: Network },
  { label: "Dependencies", icon: GitBranchPlus },
  { label: "Timeline visibility", icon: Clock3 },
  { label: "Milestone tracking", icon: Flag },
];

const platformTiles = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Project Posting", icon: FileText },
  { label: "Roadmap Views", icon: Map },
  { label: "Work Items", icon: ListTodo },
  { label: "Team Management", icon: UsersRound },
  { label: "Project Chat", icon: MessageCircle },
];

const operationsTiles = [
  { label: "Payments", icon: CreditCard },
  { label: "Time Logs", icon: Clock3 },
  { label: "Resource Hub", icon: FolderOpen },
  { label: "Notifications", icon: Bell },
  { label: "Consultant Marketplace", icon: Store },
  { label: "Shared Roadmaps", icon: Share2 },
];

export function ProductExperienceSection() {
  return (
    <section id="features" className="relative mt-16 lg:mt-20">
      <div className="pointer-events-none absolute -left-16 top-8 h-44 w-44 rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-12 h-48 w-48 rounded-full bg-indigo-200/25 blur-3xl" />

      <div className="text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Proyekto Feature
        </h2>
        <p className="mx-auto mt-3 max-w-3xl text-sm text-slate-600 sm:text-base">
          Plan, execute, and run delivery with roadmap, collaboration, operations, and marketplace tools in one connected system.
        </p>
      </div>

      <div className="relative mt-10 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_16px_34px_rgba(15,23,42,0.08)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.06)_1px,transparent_1px)] bg-[size:120px_120px]" />

        <div className="relative grid gap-px bg-slate-200/70 md:grid-cols-6">
          {topTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <div
                key={tile.label}
                className="bg-white px-4 py-6 text-center transition-colors duration-200 hover:bg-slate-50"
              >
                <Icon className="mx-auto h-5 w-5 text-slate-500" />
                <p className="mt-2 text-sm font-medium text-slate-700">{tile.label}</p>
              </div>
            );
          })}

          {coreFeatures.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className={`bg-linear-to-br ${feature.tone} p-5 md:col-span-2`}
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-blue-200 bg-white/85 text-blue-700 shadow-sm">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
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
            );
          })}

          {bottomTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <div
                key={tile.label}
                className="bg-white px-4 py-6 text-center transition-colors duration-200 hover:bg-slate-50"
              >
                <Icon className="mx-auto h-5 w-5 text-slate-500" />
                <p className="mt-2 text-sm font-medium text-slate-700">{tile.label}</p>
              </div>
            );
          })}

          {platformTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <div
                key={tile.label}
                className="bg-white px-4 py-6 text-center transition-colors duration-200 hover:bg-slate-50"
              >
                <Icon className="mx-auto h-5 w-5 text-slate-500" />
                <p className="mt-2 text-sm font-medium text-slate-700">{tile.label}</p>
              </div>
            );
          })}

          {operationsTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <div
                key={tile.label}
                className="bg-white px-4 py-6 text-center transition-colors duration-200 hover:bg-slate-50"
              >
                <Icon className="mx-auto h-5 w-5 text-slate-500" />
                <p className="mt-2 text-sm font-medium text-slate-700">{tile.label}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
