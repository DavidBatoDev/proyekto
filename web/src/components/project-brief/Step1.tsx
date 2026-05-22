import { TileOption } from "./TileOption";
import type { FormData, EngagementStage } from "./types";

interface Step1Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  compact?: boolean;
}

const EXPERTISE_OPTIONS = [
  { value: "strategy", label: "Strategy & Consulting" },
  { value: "digital-transformation", label: "Digital Transformation" },
  { value: "web", label: "Web Development" },
  { value: "mobile", label: "Mobile App" },
  { value: "design", label: "UX/UI Design" },
  { value: "data", label: "Data & Analytics" },
  { value: "ai", label: "AI / ML" },
  { value: "other", label: "Other" },
] as const;

const ENGAGEMENT_STAGES: { value: EngagementStage; label: string; description: string }[] = [
  { value: "discovery_call", label: "Discovery Call", description: "Initial briefing and scoping" },
  { value: "proposal_creation", label: "Proposal Creation", description: "Drafting scope of work or proposal" },
  { value: "active_delivery", label: "Active Delivery", description: "Engagement is underway" },
  { value: "project_closure", label: "Project Closure", description: "Wrapping up and handing over" },
];

export function Step1({ formData, updateFormData, compact = false }: Step1Props) {
  const spacing = compact ? "space-y-3" : "space-y-4";
  const inputPadding = compact ? "px-3 py-1.5" : "px-3 py-2";
  const inputSize = compact ? "text-sm" : "";
  const labelSize = compact ? "text-sm mb-1.5" : "text-sm mb-2";
  const gridGap = compact ? "gap-3" : "gap-4";

  const toggleCategory = (value: string) => {
    const current = formData.category;
    const updated = current.includes(value)
      ? current.filter((c) => c !== value)
      : [...current, value];
    updateFormData({ category: updated });
  };

  return (
    <div className={spacing}>
      {/* Client Name */}
      <div>
        <label className={`block font-semibold text-[#333438] ${labelSize}`}>
          Client Name*
        </label>
        <input
          type="text"
          placeholder="e.g., Acme Corporation"
          value={formData.clientName}
          onChange={(e) => updateFormData({ clientName: e.target.value })}
          className={`w-full ${inputPadding} ${inputSize} bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff9933] focus:border-transparent shadow-sm`}
        />
      </div>

      {/* Expertise Needed */}
      <div>
        <label className={`block font-semibold text-[#333438] ${labelSize}`}>
          Expertise Needed
        </label>
        <div className={`grid grid-cols-2 ${gridGap}`}>
          {EXPERTISE_OPTIONS.map((opt) => {
            const checked = formData.category.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                  checked
                    ? "border-[#ff9933] bg-orange-50"
                    : "border-gray-200 bg-white hover:border-[#ff9933]"
                } shadow-sm ${inputSize}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCategory(opt.value)}
                  className="w-4 h-4 accent-[#ff9933] shrink-0"
                />
                <span className="text-[#333438] font-medium leading-tight">{opt.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Project Description */}
      <div>
        <label className={`block font-semibold text-[#333438] ${labelSize}`}>
          Project Description*
        </label>
        <p className={`text-xs text-[#92969f] ${compact ? "mb-1" : "mb-2"}`}>
          • Describe the engagement in a few sentences.
        </p>
        <textarea
          placeholder="I want to build a mobile app that helps dog walkers find clients..."
          value={formData.description}
          onChange={(e) => updateFormData({ description: e.target.value })}
          rows={3}
          className={`w-full px-3 py-2 ${inputSize} bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff9933] focus:border-transparent resize-none shadow-sm`}
        />
      </div>

      {/* Engagement Stage */}
      <div>
        <label className={`block font-semibold text-[#333438] ${compact ? "text-sm mb-2" : "text-sm mb-4"}`}>
          What stage is this engagement at?
        </label>
        <div className={`grid grid-cols-2 ${gridGap}`}>
          {ENGAGEMENT_STAGES.map((stage) => (
            <TileOption
              key={stage.value}
              name="engagementStage"
              value={stage.value}
              label={stage.label}
              description={stage.description}
              checked={formData.engagementStage === stage.value}
              onChange={() => updateFormData({ engagementStage: stage.value })}
              compact={compact}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
