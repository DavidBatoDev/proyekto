import { TileOption } from "./TileOption";
import type { FormData } from "./types";

interface Step1Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  compact?: boolean; // For modal vs full-page styling
}

export function Step1({ formData, updateFormData, compact = false }: Step1Props) {
  const spacing = compact ? "space-y-3" : "space-y-4";
  const inputPadding = compact ? "px-3 py-1.5" : "px-3 py-2";
  const inputSize = compact ? "text-sm" : "";
  const labelSize = compact ? "text-sm mb-1.5" : "text-sm mb-2";
  const gridGap = compact ? "gap-3" : "gap-4";

  return (
    <div className={spacing}>
      {/* Project Title & Category */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${gridGap}`}>
        <div>
          <label className={`block font-semibold text-[#333438] ${labelSize}`}>
            Project Title*
          </label>
          <input
            type="text"
            placeholder="e.g., SaaS Dashboard for Logistics"
            value={formData.title}
            onChange={(e) => updateFormData({ title: e.target.value })}
            className={`w-full ${inputPadding} ${inputSize} bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff9933] focus:border-transparent shadow-sm`}
          />
        </div>
        <div>
          <label className={`block font-semibold text-[#333438] ${labelSize}`}>
            Category
          </label>
          <select
            value={formData.category}
            onChange={(e) => updateFormData({ category: e.target.value })}
            className={`w-full ${inputPadding} ${inputSize} bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff9933] focus:border-transparent shadow-sm`}
          >
            <option value="">Select...</option>
            <option value="web">Web Development</option>
            <option value="mobile">Mobile App</option>
            <option value="design">Design</option>
            <option value="data">Data Science</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* Project Description */}
      <div>
        <label className={`block font-semibold text-[#333438] ${labelSize}`}>
          Project Description*
        </label>
        <p className={`text-xs text-[#92969f] ${compact ? "mb-1" : "mb-2"}`}>
          • Describe your vision in a few sentences.
        </p>
        <textarea
          placeholder="I want to build a mobile app that helps dog walkers find clients..."
          value={formData.description}
          onChange={(e) => updateFormData({ description: e.target.value })}
          rows={3}
          className={`w-full px-3 py-2 ${inputSize} bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff9933] focus:border-transparent resize-none shadow-sm`}
        />
      </div>

      {/* Problem Solving */}
      <div>
        <label className={`block ${compact ? "text-xs font-medium" : "text-sm"} text-[#92969f] ${labelSize}`}>
          What is the main problem you are solving?
        </label>
        <input
          type="text"
          value={formData.problemSolving}
          onChange={(e) => updateFormData({ problemSolving: e.target.value })}
          className={`w-full ${inputPadding} ${inputSize} bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff9933] focus:border-transparent shadow-sm`}
        />
      </div>

      {/* Current State */}
      <div>
        <label className={`block font-semibold text-[#333438] ${compact ? "text-sm mb-2" : "text-sm mb-4"}`}>
          What is the current state of the project?
        </label>
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${gridGap}`}>
          <TileOption
            name="projectState"
            value="idea"
            label="Just an idea"
            description="I have a concept but no materials yet"
            checked={formData.projectState === "idea"}
            onChange={() => updateFormData({ projectState: "idea" })}
            compact={compact}
          />
          <TileOption
            name="projectState"
            value="design"
            label="Design / Prototype ready"
            description="I have designs but need development"
            checked={formData.projectState === "design"}
            onChange={() => updateFormData({ projectState: "design" })}
            compact={compact}
          />
          <TileOption
            name="projectState"
            value="sketches"
            label="Sketches / Wireframes"
            description="I have rough drawings or flows"
            checked={formData.projectState === "sketches"}
            onChange={() => updateFormData({ projectState: "sketches" })}
            compact={compact}
          />
          <TileOption
            name="projectState"
            value="codebase"
            label="Existing Codebase"
            description="I need to fix or rebuild an app"
            checked={formData.projectState === "codebase"}
            onChange={() => updateFormData({ projectState: "codebase" })}
            compact={compact}
          />
        </div>
      </div>
    </div>
  );
}
