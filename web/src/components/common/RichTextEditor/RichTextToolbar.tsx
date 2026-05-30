import type { RichTextToolbarProps, ToolType } from "./types";
import { TextFormatTool } from "./tools/TextFormatTool";
import {
  BoldTool,
  ItalicTool,
  MoreTool,
  ListTool,
  LinkTool,
  ImageTool,
  MarkdownTool,
  HelpTool,
  ToolSeparator,
} from "./tools/ToolButtons";

export function RichTextToolbar({
  tools,
  onCommand,
  activeFormats,
  compact = false,
}: RichTextToolbarProps) {
  const handleInsertLink = () => {
    const url = prompt("Enter URL:");
    if (url) {
      onCommand("createLink", url);
    }
  };

  const handleInsertImage = () => {
    const url = prompt("Enter image URL:");
    if (url) {
      onCommand("insertImage", url);
    }
  };

  const renderTool = (tool: ToolType, index: number) => {
    switch (tool) {
      case "textFormat":
        return <TextFormatTool key={index} onCommand={onCommand} />;
      case "bold":
        return (
          <BoldTool
            key={index}
            onClick={() => onCommand("bold")}
            isActive={activeFormats.has("bold")}
          />
        );
      case "italic":
        return (
          <ItalicTool
            key={index}
            onClick={() => onCommand("italic")}
            isActive={activeFormats.has("italic")}
          />
        );
      case "more":
        return <MoreTool key={index} />;
      case "bulletList":
      case "numberedList":
        // Only render once for list tool
        if (tool === "bulletList") {
          return (
            <ListTool
              key={index}
              onCommand={onCommand}
              activeFormats={activeFormats}
            />
          );
        }
        return null;
      case "link":
        return <LinkTool key={index} onInsertLink={handleInsertLink} />;
      case "image":
        return <ImageTool key={index} onInsertImage={handleInsertImage} />;
      case "separator":
        return <ToolSeparator key={index} />;
      default:
        return null;
    }
  };

  return (
    <div className={`flex items-center gap-1 border-b border-gray-200 bg-gray-50 rounded-t-lg flex-wrap ${compact ? "px-2 py-1" : "px-3 py-2"}`}>
      {/* Left side tools */}
      <div className="flex items-center gap-1">
        {tools
          .filter(
            (t: ToolType) =>
              ![
                "separator",
                "image",
                "link",
                "more",
                "bulletList",
                "numberedList",
              ].includes(t),
          )
          .map((tool: ToolType, index: number) => renderTool(tool, index))}
      </div>

      {/* Separator */}
      {tools.some((t: ToolType) =>
        ["bulletList", "numberedList", "link", "image"].includes(t),
      ) && <ToolSeparator />}

      {/* Middle tools */}
      <div className="flex items-center gap-1">
        {(tools.includes("bulletList") || tools.includes("numberedList")) && (
          <ListTool onCommand={onCommand} activeFormats={activeFormats} />
        )}
        {tools.includes("image") && (
          <ImageTool onInsertImage={handleInsertImage} />
        )}
        {tools.includes("more") && <MoreTool />}
      </div>

      {/* Right side tools */}
      <div className="flex items-center gap-1 ml-auto">
        {tools.includes("link") && <LinkTool onInsertLink={handleInsertLink} />}
        <MarkdownTool />
        <HelpTool />
      </div>
    </div>
  );
}
