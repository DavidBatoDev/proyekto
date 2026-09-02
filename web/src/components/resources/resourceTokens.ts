import type { LucideIcon } from "lucide-react";
import {
	Bot,
	Box,
	Braces,
	Briefcase,
	Building2,
	Code2,
	Cpu,
	Database,
	FileText,
	Folder,
	Gauge,
	Globe,
	Layers,
	Package,
	Palette,
	Rocket,
	Server,
	Sparkles,
	Terminal,
	Wrench,
} from "lucide-react";

/**
 * Icon and accent tokens a resource folder may carry, shared by the project
 * Resources page and the team Overview's Resources section.
 *
 * The tokens themselves are also declared on the backend
 * (`common/resources/folder-tokens.ts`), which validates them. The two lists
 * cannot literally be one array — this one carries lucide components and
 * Tailwind class strings — so the lookups below fall back rather than throw:
 * a token the backend gained and the web has not yet learned renders as a plain
 * folder instead of crashing the grid.
 */
export const RESOURCE_FOLDER_ICONS: { token: string; Icon: LucideIcon }[] = [
	{ token: "folder", Icon: Folder },
	{ token: "code", Icon: Code2 },
	{ token: "terminal", Icon: Terminal },
	{ token: "bot", Icon: Bot },
	{ token: "package", Icon: Package },
	{ token: "database", Icon: Database },
	{ token: "globe", Icon: Globe },
	{ token: "server", Icon: Server },
	{ token: "cpu", Icon: Cpu },
	{ token: "layers", Icon: Layers },
	{ token: "braces", Icon: Braces },
	{ token: "rocket", Icon: Rocket },
	{ token: "wrench", Icon: Wrench },
	{ token: "briefcase", Icon: Briefcase },
	{ token: "building", Icon: Building2 },
	{ token: "palette", Icon: Palette },
	{ token: "gauge", Icon: Gauge },
	{ token: "sparkles", Icon: Sparkles },
	{ token: "file-text", Icon: FileText },
	{ token: "box", Icon: Box },
];

export const RESOURCE_FOLDER_COLORS: {
	token: string;
	label: string;
	/** Swatch in the picker. */
	swatch: string;
	/** The card's top border — the thing that makes a folder findable. It is
	 *  applied inline because `.app-surface-card` sets a `border` shorthand that
	 *  outranks Tailwind's border utilities. */
	accent: string;
}[] = [
	{
		token: "white",
		label: "None",
		swatch: "bg-white border border-slate-300",
		accent: "var(--color-white)",
	},
	{
		token: "slate",
		label: "Slate",
		swatch: "bg-slate-400",
		accent: "var(--color-slate-400)",
	},
	{
		token: "red",
		label: "Red",
		swatch: "bg-red-500",
		accent: "var(--color-red-500)",
	},
	{
		token: "orange",
		label: "Orange",
		swatch: "bg-orange-500",
		accent: "var(--color-orange-500)",
	},
	{
		token: "amber",
		label: "Amber",
		swatch: "bg-amber-500",
		accent: "var(--color-amber-500)",
	},
	{
		token: "green",
		label: "Green",
		swatch: "bg-green-500",
		accent: "var(--color-green-500)",
	},
	{
		token: "teal",
		label: "Teal",
		swatch: "bg-teal-500",
		accent: "var(--color-teal-500)",
	},
	{
		token: "blue",
		label: "Blue",
		swatch: "bg-blue-600",
		accent: "var(--color-blue-600)",
	},
	{
		token: "violet",
		label: "Violet",
		swatch: "bg-violet-500",
		accent: "var(--color-violet-500)",
	},
	{
		token: "pink",
		label: "Pink",
		swatch: "bg-pink-500",
		accent: "var(--color-pink-500)",
	},
];

export const DEFAULT_FOLDER_ICON = "folder";
export const DEFAULT_FOLDER_COLOR = "white";

export function folderIconOf(token: string | undefined): LucideIcon {
	return (
		RESOURCE_FOLDER_ICONS.find((entry) => entry.token === token)?.Icon ?? Folder
	);
}

export function folderColorOf(token: string | undefined) {
	return (
		RESOURCE_FOLDER_COLORS.find((entry) => entry.token === token) ??
		RESOURCE_FOLDER_COLORS[0]
	);
}

/** Sentinel folder id for the synthetic "Uncategorized" bucket. */
export const UNCATEGORIZED_ID = "uncategorized";
