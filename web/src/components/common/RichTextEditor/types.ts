import type { ReactNode } from "react";

export type ToolType =
  | "textFormat"
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "bulletList"
  | "numberedList"
  | "checkList"
  | "link"
  | "image"
  | "code"
  | "blockquote"
  | "separator"
  | "more";

export interface ToolOption {
  label: string;
  value: string;
  icon?: ReactNode;
  action: () => void;
}

export interface ToolConfig {
  type: ToolType;
  icon?: ReactNode;
  label?: string;
  tooltip?: string;
  options?: ToolOption[];
}

export interface MentionUser {
  id: string;
  display_name: string;
  avatar_url?: string | null;
}

export interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  tools?: ToolType[];
  minHeight?: string;
  maxHeight?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  mentionUsers?: MentionUser[];
  compact?: boolean;
}

export interface RichTextToolbarProps {
  tools: ToolType[];
  onCommand: (command: string, value?: string) => void;
  activeFormats: Set<string>;
  compact?: boolean;
}

export type FormatCommand =
  | "bold"
  | "italic"
  | "underline"
  | "strikeThrough"
  | "insertUnorderedList"
  | "insertOrderedList"
  | "formatBlock"
  | "createLink"
  | "insertImage";
