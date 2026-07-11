import {
	Archive,
	Briefcase,
	Circle,
	CircleCheck,
	CircleDashed,
	CircleDot,
	CirclePause,
	CircleX,
	Clock3,
	Shield,
	type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BadgeProps {
	children: ReactNode;
	icon: LucideIcon;
	iconClassName?: string;
	className?: string;
	appearance?: "badge" | "menu";
	trailing?: ReactNode;
}

export function SemanticBadge({
	children,
	icon: Icon,
	iconClassName,
	className,
	appearance = "badge",
	trailing,
}: BadgeProps) {
	return (
		<span
			data-semantic-badge={appearance}
			className={cn(
				"inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground",
				appearance === "badge" &&
					"rounded-full border border-border bg-muted px-2 py-0.5 text-[11px]",
				appearance === "menu" && "text-sm",
				className,
			)}
		>
			<Icon className={cn("h-3.5 w-3.5 shrink-0", iconClassName)} />
			<span className="truncate">{children}</span>
			{trailing}
		</span>
	);
}

const PROJECT_STATUS_ICONS: Record<
	string,
	{ icon: LucideIcon; iconClassName: string }
> = {
	bidding: { icon: CircleDot, iconClassName: "text-info" },
	draft: { icon: CircleDashed, iconClassName: "text-warning" },
	active: { icon: CircleCheck, iconClassName: "text-success" },
	completed: { icon: CircleCheck, iconClassName: "text-success" },
	paused: { icon: CirclePause, iconClassName: "text-muted-foreground" },
	archived: { icon: Archive, iconClassName: "text-muted-foreground" },
};

export function ProjectStatusBadge({
	status,
	label,
	className,
}: {
	status: string;
	label?: string;
	className?: string;
}) {
	const normalized = status.toLowerCase().replaceAll(" ", "_");
	const config = PROJECT_STATUS_ICONS[normalized] ?? {
		icon: Circle,
		iconClassName: "text-muted-foreground",
	};
	return (
		<SemanticBadge {...config} className={className}>
			{label ?? status}
		</SemanticBadge>
	);
}

const TASK_STATUS_CONFIG: Record<
	string,
	{ label: string; icon: LucideIcon; iconClassName: string }
> = {
	backlog: {
		label: "Backlog",
		icon: CircleDashed,
		iconClassName: "text-muted-foreground",
	},
	todo: { label: "Todo", icon: Circle, iconClassName: "text-muted-foreground" },
	in_progress: {
		label: "In Progress",
		icon: CircleDot,
		iconClassName: "text-warning",
	},
	in_review: { label: "In Review", icon: Clock3, iconClassName: "text-info" },
	not_started: {
		label: "Not Started",
		icon: Circle,
		iconClassName: "text-muted-foreground",
	},
	done: { label: "Done", icon: CircleCheck, iconClassName: "text-success" },
	completed: {
		label: "Completed",
		icon: CircleCheck,
		iconClassName: "text-success",
	},
	blocked: { label: "Blocked", icon: CircleX, iconClassName: "text-destructive" },
	canceled: {
		label: "Canceled",
		icon: CircleX,
		iconClassName: "text-muted-foreground",
	},
	duplicate: {
		label: "Duplicate",
		icon: CirclePause,
		iconClassName: "text-muted-foreground",
	},
};

export function TaskStatusBadge({
	status,
	className,
	appearance,
	trailing,
}: {
	status: string;
	className?: string;
	appearance?: "badge" | "menu";
	trailing?: ReactNode;
}) {
	const normalized = status.toLowerCase().replaceAll(" ", "_");
	const config = TASK_STATUS_CONFIG[normalized] ?? {
		label: status.replaceAll("_", " "),
		icon: Circle,
		iconClassName: "text-muted-foreground",
	};
	return (
		<SemanticBadge
			icon={config.icon}
			iconClassName={config.iconClassName}
			className={className}
			appearance={appearance}
			trailing={trailing}
		>
			{config.label}
		</SemanticBadge>
	);
}

export function PositionBadge({ children }: { children: ReactNode }) {
	return (
		<SemanticBadge icon={Briefcase} iconClassName="text-muted-foreground">
			{children}
		</SemanticBadge>
	);
}

export function RoleBadge({ children }: { children: ReactNode }) {
	return (
		<SemanticBadge icon={Shield} iconClassName="text-muted-foreground">
			{children}
		</SemanticBadge>
	);
}
