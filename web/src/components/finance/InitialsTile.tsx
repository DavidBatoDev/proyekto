import { initialsOf } from "@/components/common/Avatar";
import { cn } from "@/lib/utils";

/**
 * Tints drawn from the semantic tokens, so a tile follows the theme — minus the
 * destructive red, which on a person or a team reads as something being wrong.
 * Which one
 * a name gets is a hash of the name — stable across renders and pages, so
 * "JC Studio" is the same colour in the launcher, the sidebar, and its own
 * header.
 */
const TINTS = [
	"bg-primary/10 text-primary",
	"bg-info/10 text-info-foreground",
	"bg-success/10 text-success-foreground",
	"bg-warning/15 text-warning-foreground",
	"bg-foreground/10 text-foreground",
] as const;

function tintFor(name: string): string {
	let hash = 0;
	for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	return TINTS[hash % TINTS.length];
}

const BOX = {
	sm: "h-7 w-7 text-[10px]",
	md: "h-10 w-10 text-xs",
	lg: "h-12 w-12 text-sm",
} as const;

/**
 * Who a finance row is about, at a glance: a team (square) or a person
 * (round). Finance lists are scanned by counterparty, and a generic icon in
 * every row gives the eye nothing to land on.
 */
export function InitialsTile({
	name,
	shape = "square",
	size = "md",
	className,
}: {
	name: string;
	shape?: "square" | "round";
	size?: keyof typeof BOX;
	className?: string;
}) {
	return (
		<span
			aria-hidden
			className={cn(
				"flex shrink-0 items-center justify-center font-bold",
				shape === "round" ? "rounded-full" : "rounded-xl",
				BOX[size],
				tintFor(name),
				className,
			)}
		>
			{initialsOf(name)}
		</span>
	);
}

/** Overlapping people, capped — the rest collapse into a "+n". */
export function InitialsStack({
	names,
	max = 4,
}: {
	names: string[];
	max?: number;
}) {
	if (names.length === 0) return null;
	const shown = names.slice(0, max);
	const rest = names.length - shown.length;
	return (
		<span className="flex items-center -space-x-1.5">
			{shown.map((name) => (
				<InitialsTile
					key={name}
					name={name}
					shape="round"
					size="sm"
					className="ring-2 ring-background"
				/>
			))}
			{rest > 0 ? (
				<span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground ring-2 ring-background">
					+{rest}
				</span>
			) : null}
		</span>
	);
}
