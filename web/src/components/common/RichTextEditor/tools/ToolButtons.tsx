import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Link as LinkIcon,
  Image as ImageIcon,
  MoreHorizontal,
  ChevronDown,
  Paperclip,
  FileCode,
  HelpCircle,
  Underline,
  Strikethrough,
  Eraser,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface ToolButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  isActive?: boolean;
  tooltip?: string;
  className?: string;
}

export function ToolButton({
  icon,
  onClick,
  isActive,
  tooltip,
  className = "",
}: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${
        isActive
          ? "bg-blue-100 text-blue-600"
          : "text-gray-700 hover:bg-gray-100"
      } ${className}`}
      title={tooltip}
    >
      {icon}
    </button>
  );
}

interface ListToolProps {
  onCommand: (command: string) => void;
  activeFormats: Set<string>;
}

export function ListTool({ onCommand, activeFormats }: ListToolProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isActive =
    activeFormats.has("insertUnorderedList") ||
    activeFormats.has("insertOrderedList");

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1 p-1.5 rounded transition-colors ${
          isActive
            ? "bg-blue-100 text-blue-600"
            : "text-gray-700 hover:bg-gray-100"
        }`}
        title="Lists"
      >
        <List className="w-4 h-4" />
        <ChevronDown className="w-3 h-3" />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
          <button
            type="button"
            onClick={() => {
              onCommand("insertUnorderedList");
              setIsOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 transition-colors"
          >
            <List className="w-4 h-4" />
            Bullet List
          </button>
          <button
            type="button"
            onClick={() => {
              onCommand("insertOrderedList");
              setIsOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 transition-colors"
          >
            <ListOrdered className="w-4 h-4" />
            Numbered List
          </button>
        </div>
      )}
    </div>
  );
}

interface LinkToolProps {
  onInsertLink: () => void;
}

export function LinkTool({ onInsertLink }: LinkToolProps) {
  return (
    <ToolButton
      icon={<LinkIcon className="w-4 h-4" />}
      onClick={onInsertLink}
      tooltip="Insert link"
    />
  );
}

interface ImageToolProps {
  onInsertImage: () => void;
}

export function ImageTool({ onInsertImage }: ImageToolProps) {
  return (
    <ToolButton
      icon={<ImageIcon className="w-4 h-4" />}
      onClick={onInsertImage}
      tooltip="Insert image"
    />
  );
}

export function BoldTool({
  onClick,
  isActive,
}: {
  onClick: () => void;
  isActive: boolean;
}) {
  return (
    <ToolButton
      icon={<Bold className="w-4 h-4" />}
      onClick={onClick}
      isActive={isActive}
      tooltip="Bold"
    />
  );
}

export function ItalicTool({
  onClick,
  isActive,
}: {
  onClick: () => void;
  isActive: boolean;
}) {
  return (
    <ToolButton
      icon={<Italic className="w-4 h-4" />}
      onClick={onClick}
      isActive={isActive}
      tooltip="Italic"
    />
  );
}

interface MoreToolProps {
  onCommand: (command: string) => void;
  activeFormats: Set<string>;
}

export function MoreTool({ onCommand, activeFormats }: MoreToolProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen]);

  const items = [
    {
      label: "Underline",
      icon: <Underline className="w-4 h-4" />,
      command: "underline",
      active: activeFormats.has("underline"),
    },
    {
      label: "Strikethrough",
      icon: <Strikethrough className="w-4 h-4" />,
      command: "strikeThrough",
      active: activeFormats.has("strikeThrough"),
    },
    {
      label: "Remove formatting",
      icon: <Eraser className="w-4 h-4" />,
      command: "removeFormat",
      active: false,
    },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={`p-1.5 rounded transition-colors ${
          isOpen ? "bg-gray-200 text-gray-900" : "text-gray-700 hover:bg-gray-100"
        }`}
        title="More options"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.command}
              type="button"
              onClick={() => {
                onCommand(item.command);
                setIsOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-sm transition-colors ${
                item.active
                  ? "bg-blue-50 text-blue-600"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AttachmentTool() {
  return (
    <ToolButton
      icon={<Paperclip className="w-4 h-4" />}
      onClick={() => {}}
      tooltip="Attach file"
    />
  );
}

export function MarkdownTool() {
  return (
    <ToolButton
      icon={<FileCode className="w-4 h-4" />}
      onClick={() => {}}
      tooltip="Markdown mode"
    />
  );
}

export function HelpTool() {
  return (
    <ToolButton
      icon={<HelpCircle className="w-4 h-4" />}
      onClick={() => {}}
      tooltip="Help"
    />
  );
}

export function ToolSeparator() {
  return <div className="w-px h-5 bg-gray-300" />;
}
