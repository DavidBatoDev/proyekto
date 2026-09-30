import {
	Ban,
	CircleEllipsis,
	EyeOff,
	HeartCrack,
	type LucideIcon,
	Megaphone,
	MessageSquareWarning,
	ShieldAlert,
} from "lucide-react";
import type { ReportReason, ReportTargetType } from "@/services/safety.service";

export interface ReasonOption {
	value: ReportReason;
	title: string;
	hint: string;
	icon: LucideIcon;
}

/** The order people scan in: the common reasons first, "something else" last. */
export const REPORT_REASONS: ReasonOption[] = [
	{
		value: "spam",
		title: "Spam",
		hint: "Ads, scams or repeated unwanted messages",
		icon: Megaphone,
	},
	{
		value: "harassment",
		title: "Harassment or bullying",
		hint: "Insults, intimidation or targeting someone",
		icon: MessageSquareWarning,
	},
	{
		value: "hate",
		title: "Hate speech",
		hint: "Attacks on people for who they are",
		icon: Ban,
	},
	{
		value: "sexual",
		title: "Sexual content",
		hint: "Nudity or sexually explicit material",
		icon: EyeOff,
	},
	{
		value: "violence",
		title: "Violence or threats",
		hint: "Threatening or glorifying harm",
		icon: ShieldAlert,
	},
	{
		value: "self_harm",
		title: "Self-harm",
		hint: "Someone may be at risk",
		icon: HeartCrack,
	},
	{
		value: "other",
		title: "Something else",
		hint: "Another reason it breaks the rules",
		icon: CircleEllipsis,
	},
];

export const DETAILS_MAX = 1000;

export function reportTitle(type: ReportTargetType, name: string): string {
	switch (type) {
		case "chat_message":
			return "Report message";
		case "user":
			return `Report ${name}`;
		default:
			return "Report comment";
	}
}

export function firstName(name: string): string {
	return name.trim().split(/\s+/)[0] || name;
}
