import { useState } from "react";
import { X, CornerDownLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { TileOption } from "./TileOption";
import type { FormData } from "./types";

interface Step2Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  compact?: boolean; // For modal vs full-page styling
}

export function Step2({
  formData,
  updateFormData,
  compact = false,
}: Step2Props) {
  const [skillInput, setSkillInput] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const { data: skillsData } = useQuery({
    queryKey: ["skills"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("skills")
        .select("name, slug")
        .order("name");

      if (error) throw error;
      return data as { name: string; slug: string }[];
    },
  });

  const generalSkills = skillsData?.map((s) => s.name) || [
    "Graphic Design",
    "Content Writing",
    "Web Development",
    "Data Entry",
    "Digital Marketing",
    "Project Management",
    "Translation",
    "Video Editing",
    "SEO",
    "Social Media Marketing",
    "Virtual Assistant",
    "Illustration",
    "3D Modeling",
    "Voice Over",
    "Customer Service",
    "Accounting",
    "Legal Consulting",
    "HR & Recruiting",
    "Photography",
    "Videography",
  ];

  const filteredSkills = generalSkills.filter(
    (skill) =>
      skill.toLowerCase().includes(skillInput.toLowerCase()) &&
      !formData.skills.includes(skill),
  );

  const addSkill = (skill: string) => {
    const existingSkill = generalSkills.find(
      (s) => s.toLowerCase() === skill.toLowerCase(),
    );

    if (existingSkill) {
      if (!formData.skills.includes(existingSkill)) {
        updateFormData({ skills: [...formData.skills, existingSkill] });
      }
    } else {
      const isDuplicateCustom = formData.customSkills.some(
        (s) => s.toLowerCase() === skill.toLowerCase(),
      );

      if (!isDuplicateCustom) {
        updateFormData({ customSkills: [...formData.customSkills, skill] });
      }
    }
    setSkillInput("");
    setShowDropdown(false);
  };

  const removeSkill = (skill: string) => {
    if (formData.skills.includes(skill)) {
      updateFormData({ skills: formData.skills.filter((s) => s !== skill) });
    }
    if (formData.customSkills.includes(skill)) {
      updateFormData({
        customSkills: formData.customSkills.filter((s) => s !== skill),
      });
    }
  };

  const spacing = compact ? "space-y-3" : "space-y-4";
  const inputPadding = compact ? "px-3 py-1.5" : "px-3 py-2";
  const inputSize = compact ? "text-sm" : "";
  const labelSize = compact ? "text-sm mb-1.5" : "text-sm mb-2";
  const skillChipPadding = compact ? "px-3 py-1" : "px-4 py-1.5";
  const skillChipSize = compact ? "text-xs" : "text-sm";
  const skillChipGap = compact ? "gap-1.5" : "gap-2";
  const skillIconSize = compact ? "w-3 h-3" : "w-3 h-3";
  const suggestionSize = compact ? "text-[11px]" : "text-xs";
  const suggestionPadding = compact ? "px-2.5 py-1" : "px-3 py-1";
  const gridGap = compact ? "gap-3" : "gap-4";
  const iconTopPosition = compact ? "top-2" : "top-2.5";
  const iconSize = compact ? "w-4 h-4" : "w-5 h-5";
  const dropdownPadding = compact ? "px-3 py-1.5" : "px-4 py-2";
  const marginBottom = compact ? "mb-3" : "mb-4";
  const popularMarginTop = compact ? "mt-3" : "mt-4";
  const popularMarginBottom = compact ? "mb-1.5" : "mb-2";

  return (
    <div className={spacing}>
      {/* Skills */}
      <div className="relative">
        <label className={`block font-semibold text-[#333438] ${labelSize}`}>
          What skills or tools are required?
        </label>
        <div className="relative">
          <input
            type="text"
            placeholder="Search skills (e.g. Graphic Design, Writing)"
            value={skillInput}
            onChange={(e) => {
              setSkillInput(e.target.value);
              setShowDropdown(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && skillInput.trim()) {
                e.preventDefault();
                addSkill(skillInput.trim());
              }
            }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            className={`w-full ${inputPadding} ${inputSize} bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#e91e63] focus:border-transparent ${marginBottom} shadow-sm pr-10`}
          />
          <div
            className={`absolute right-3 ${iconTopPosition} transition-colors duration-200 pointer-events-none ${
              skillInput.trim() ? "text-[#ff9933]" : "text-gray-300"
            }`}
          >
            <CornerDownLeft className={iconSize} />
          </div>
          {showDropdown && skillInput && filteredSkills.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
              {filteredSkills.map((skill) => (
                <button
                  key={skill}
                  onClick={() => addSkill(skill)}
                  className={`w-full text-left ${dropdownPadding} hover:bg-gray-50 text-[#333438] ${inputSize} transition-colors`}
                >
                  {skill}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected Skills */}
        <div className={`flex flex-wrap ${skillChipGap}`}>
          {[...formData.skills, ...formData.customSkills].map((skill) => (
            <div
              key={skill}
              className={`${skillChipPadding} bg-white border border-gray-300 text-[#333438] rounded-full ${skillChipSize} flex items-center ${skillChipGap} shadow-sm cursor-pointer hover:border-red-500 hover:text-red-500 transition-colors group`}
              onClick={() => removeSkill(skill)}
            >
              {skill}
              <X
                className={`${skillIconSize} text-gray-400 group-hover:text-red-500 transition-colors`}
              />
            </div>
          ))}
        </div>

        {/* Popular Suggestions */}
        <div className={popularMarginTop}>
          <p
            className={`${suggestionSize} text-[#92969f] ${popularMarginBottom} font-medium`}
          >
            Popular Skills
          </p>
          <div className={`flex flex-wrap ${skillChipGap}`}>
            {generalSkills
              .filter((skill) => !formData.skills.includes(skill))
              .slice(0, 14)
              .map((skill) => (
                <button
                  key={skill}
                  onClick={() => addSkill(skill)}
                  className={`${suggestionPadding} bg-white border border-gray-200 text-[#61636c] rounded-full ${suggestionSize} hover:border-[#ff9933] hover:text-[#ff9933] transition-colors`}
                >
                  + {skill}
                </button>
              ))}
          </div>
        </div>
      </div>

      {/* Expected Duration */}
      <div>
        <label
          className={`block font-semibold text-[#333438] ${compact ? "text-sm mb-2.5" : "text-sm mb-4"}`}
        >
          Expected Duration
        </label>
        <div className={`grid grid-cols-2 ${gridGap}`}>
          <TileOption
            name="duration"
            value="<1_month"
            label="Less than 1 month"
            checked={formData.duration === "<1_month"}
            onChange={() => updateFormData({ duration: "<1_month" })}
            compact={compact}
          />
          <TileOption
            name="duration"
            value="1-3_months"
            label="1-3 months"
            checked={formData.duration === "1-3_months"}
            onChange={() => updateFormData({ duration: "1-3_months" })}
            compact={compact}
          />
          <TileOption
            name="duration"
            value="3-6_months"
            label="3-6 months"
            checked={formData.duration === "3-6_months"}
            onChange={() => updateFormData({ duration: "3-6_months" })}
            compact={compact}
          />
          <TileOption
            name="duration"
            value="6+_months"
            label="More than 6 months"
            checked={formData.duration === "6+_months"}
            onChange={() => updateFormData({ duration: "6+_months" })}
            compact={compact}
          />
        </div>
      </div>
    </div>
  );
}
