import { useState, useRef, useEffect } from "react";
import { X, Plus, Tag } from "lucide-react";
import type { Label } from "@/types/label";
import { LABEL_COLORS } from "@/types/label";

interface LabelSelectorProps {
  selectedLabels: Label[];
  onLabelsChange: (labels: Label[]) => void;
  availableLabels?: Label[];
}

export function LabelSelector({
  selectedLabels,
  onLabelsChange,
  availableLabels = [],
}: LabelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [selectedColor, setSelectedColor] = useState(LABEL_COLORS[0]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setIsCreating(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCreateLabel = () => {
    if (!newLabelName.trim()) return;

    const newLabel: Label = {
      id: `label-${Date.now()}`,
      name: newLabelName.trim(),
      color: selectedColor,
    };

    onLabelsChange([...selectedLabels, newLabel]);
    setNewLabelName("");
    setSelectedColor(LABEL_COLORS[0]);
    setIsCreating(false);
  };

  const handleToggleLabel = (label: Label) => {
    const isSelected = selectedLabels.some((l) => l.id === label.id);
    if (isSelected) {
      onLabelsChange(selectedLabels.filter((l) => l.id !== label.id));
    } else {
      onLabelsChange([...selectedLabels, label]);
    }
  };

  const handleRemoveLabel = (labelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onLabelsChange(selectedLabels.filter((l) => l.id !== labelId));
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Selected Labels Display */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {selectedLabels.map((label) => (
          <span
            key={label.id}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium"
            style={{
              backgroundColor: label.color,
              color: getContrastColor(label.color),
            }}
          >
            {label.name}
            <button
              type="button"
              onClick={(e) => handleRemoveLabel(label.id, e)}
              className="hover:opacity-70 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>

      {/* Add Label Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition-colors border border-gray-200"
      >
        <Tag className="w-4 h-4" />
        Labels
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-lg shadow-lg z-50">
          {!isCreating ? (
            <>
              {/* Header */}
              <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900">Labels</h3>
              </div>

              {/* Available Labels */}
              <div className="max-h-64 overflow-y-auto p-2">
                {availableLabels.length === 0 && selectedLabels.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No labels yet. Create one below.
                  </p>
                ) : (
                  <>
                    {/* Show all unique labels */}
                    {[...selectedLabels, ...availableLabels]
                      .filter(
                        (label, index, self) =>
                          index === self.findIndex((l) => l.id === label.id),
                      )
                      .map((label) => {
                        const isSelected = selectedLabels.some(
                          (l) => l.id === label.id,
                        );
                        return (
                          <button
                            key={label.id}
                            type="button"
                            onClick={() => handleToggleLabel(label)}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 rounded-md transition-colors"
                          >
                            <div
                              className="w-full px-3 py-1.5 rounded text-sm font-medium text-left"
                              style={{
                                backgroundColor: label.color,
                                color: getContrastColor(label.color),
                              }}
                            >
                              {label.name}
                            </div>
                            {isSelected && (
                              <div className="w-5 h-5 bg-blue-500 rounded flex items-center justify-center shrink-0">
                                <svg
                                  className="w-3 h-3 text-white"
                                  fill="none"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path d="M5 13l4 4L19 7"></path>
                                </svg>
                              </div>
                            )}
                          </button>
                        );
                      })}
                  </>
                )}
              </div>

              {/* Create New Label Button */}
              <div className="p-2 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setIsCreating(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Create new label
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Create Label Form */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <button
                    type="button"
                    onClick={() => setIsCreating(false)}
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path d="M15 19l-7-7 7-7"></path>
                    </svg>
                  </button>
                  <h3 className="text-sm font-semibold text-gray-900">
                    Create label
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreating(false);
                      setNewLabelName("");
                      setSelectedColor(LABEL_COLORS[0]);
                    }}
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Preview */}
                <div
                  className="w-full px-4 py-2 rounded-md text-sm font-medium mb-4 text-center"
                  style={{
                    backgroundColor: selectedColor,
                    color: getContrastColor(selectedColor),
                  }}
                >
                  {newLabelName || "Label preview"}
                </div>

                {/* Title Input */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Title
                  </label>
                  <input
                    type="text"
                    value={newLabelName}
                    onChange={(e) => setNewLabelName(e.target.value)}
                    placeholder="Label name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>

                {/* Color Picker */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select a color
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {LABEL_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setSelectedColor(color)}
                        className="w-full aspect-video rounded-md transition-all hover:scale-110 relative"
                        style={{ backgroundColor: color }}
                      >
                        {selectedColor === color && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <svg
                              className="w-5 h-5 text-white drop-shadow-md"
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="3"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path d="M5 13l4 4L19 7"></path>
                            </svg>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-center gap-2">
                  {/* Remove Color Button */}
                  <button
                    type="button"
                    onClick={() => setSelectedColor(LABEL_COLORS[0])}
                    className="py-2 w-full flex items-center justify-center gap-2 px-4 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors border border-gray-200"
                  >
                    Remove color
                  </button>

                  {/* Create Button */}
                  <button
                    type="button"
                    onClick={handleCreateLabel}
                    disabled={!newLabelName.trim()}
                    className="py-2 w-full px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  >
                    Create
                  </button>
                  
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Helper function to determine text color based on background
function getContrastColor(hexColor: string): string {
  // Convert hex to RGB
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black or white based on luminance
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}
