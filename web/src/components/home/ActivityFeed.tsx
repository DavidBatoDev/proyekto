import { useAuthStore } from "@/stores/authStore";

type ActionItem = {
  id: string;
  stage: string;
  title: string;
  subtitle: string;
  timestamp: string;
};

export function ActivityFeed() {
  const { profile } = useAuthStore();
  const persona = profile?.active_persona || "client";
  const isFreelancer = persona === "freelancer";

  const recentActivity: Array<{
    id: string;
    project: string;
    title: string;
    subtitle: string;
    timestamp: string;
  }> = isFreelancer
    ? [
        {
          id: "update-1",
          project: "Matching",
          title: "Profile queued for consultant review",
          subtitle: "Your freelancer profile is visible in current matching rounds.",
          timestamp: "12m ago",
        },
      ]
    : [];
  const hasNoRecentActivity = recentActivity.length === 0;

  const recommendedActions: ActionItem[] =
    persona === "freelancer"
      ? [
          {
            id: "activation",
            stage: "Step 1",
            title: "Activation",
            subtitle: "Complete your profile so consultants can match you to active project roadmaps.",
            timestamp: "just now",
          },
          {
            id: "matching",
            stage: "Step 2",
            title: "Matching",
            subtitle: "Consultants review project needs and match specialists to execution roles.",
            timestamp: "when activated",
          },
          {
            id: "contribution",
            stage: "Step 3",
            title: "Contribution",
            subtitle: "Once matched, you collaborate on scoped milestones and delivery checkpoints.",
            timestamp: "after matching",
          },
        ]
      : [
          {
            id: "vision",
            stage: "Step 1",
            title: "Project Vision",
            subtitle: "Post your vision so the system can initiate consultant matching.",
            timestamp: "just now",
          },
          {
            id: "matching",
            stage: "Step 2",
            title: "Consultant Matching",
            subtitle: "A consultant is aligned to your project scope and delivery goals.",
            timestamp: "after posting",
          },
          {
            id: "roadmap",
            stage: "Step 3",
            title: "Roadmap + Execution",
            subtitle: "Your roadmap is generated, then freelancers are staffed to execute milestones.",
            timestamp: "next",
          },
        ];

  return (
    <div>
      <h3 className="text-[20px] font-semibold text-black mb-3 py-3">
        RECENT UPDATES
      </h3>
      <div className="bg-white rounded-xl shadow-sm p-6 max-h-[481px] overflow-y-auto hide-scrollbar">
        {hasNoRecentActivity ? (
          <div className="space-y-4">
            <div>
              <p className="text-[16px] font-bold text-black mb-1">Your journey starts here</p>
              <p className="text-[14px] text-[#61636c]">
                {persona === "freelancer"
                  ? "This feed tracks how you move from activation to matched delivery work."
                  : "This feed tracks your path from vision to matched execution."}
              </p>
            </div>

            <div>
              <p className="text-[16px] font-bold text-black mb-3">What happens next</p>
              <div className="space-y-3">
                {recommendedActions.map((item) => (
                  <ActivityFeedItem
                    key={item.id}
                    project={item.stage}
                    title={item.title}
                    subtitle={item.subtitle}
                    timestamp={item.timestamp}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {recentActivity.map((item) => (
              <ActivityFeedItem
                key={item.id}
                project={item.project}
                title={item.title}
                subtitle={item.subtitle}
                timestamp={item.timestamp}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityFeedItem({
  project,
  title,
  subtitle,
  timestamp,
}: {
  project: string;
  title: string;
  subtitle: string;
  timestamp: string;
}) {
  return (
    <button
      type="button"
      onClick={() => console.info("Update opened:", title)}
      className="flex w-full items-center gap-4 rounded-xl bg-muted p-2 text-left shadow-sm transition-colors hover:bg-accent"
    >
      <span className="text-[16px] text-[#333438] min-w-[100px]">
        {project}
      </span>
      <div className="w-px h-[39px] bg-gray-300" />
      <div className="flex-1">
        <p className="text-[14px] text-black">{title}</p>
        <p className="text-[14px] text-[#92969f]">{subtitle}</p>
      </div>
      <span className="text-[11px] text-[#92969f] whitespace-nowrap">{timestamp}</span>
    </button>
  );
}
