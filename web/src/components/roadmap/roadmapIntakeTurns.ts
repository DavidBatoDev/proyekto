import type { RoadmapIntakeCaptured } from "@/services/roadmap.service";
import type { AgentClarifierAnswerEntry } from "@/services/roadmap-agent.service";

/**
 * Pure helpers for the guided roadmap intake, kept out of RoadmapBuilder so
 * they are testable without rendering the whole builder. Mirrors the
 * `*.logic.ts` convention used under components/roadmap/ai/.
 */

export const INTAKE_SLOT_CHIPS: {
	key: keyof RoadmapIntakeCaptured;
	label: string;
}[] = [
	{ key: "product", label: "Product" },
	{ key: "audience", label: "Audience" },
	{ key: "features", label: "v1 features" },
	{ key: "platform", label: "Platform" },
	{ key: "constraints", label: "Constraints" },
];

export const isSlotFilled = (
	captured: RoadmapIntakeCaptured,
	key: keyof RoadmapIntakeCaptured,
): boolean => {
	const value = captured[key];
	if (Array.isArray(value)) return value.length > 0;
	return typeof value === "string" && value.trim().length > 0;
};

/**
 * Flattens clarifier answers into one transcript turn. Keeps the question text
 * alongside the answer so the model can see what each answer responded to -
 * bare values would strand it in the same amnesia the free-text path had.
 */
export const buildTurnFromAnswers = (
	answers: AgentClarifierAnswerEntry[],
): string =>
	answers
		.map((answer) => {
			const values = [...answer.selected_options, answer.custom_answer]
				.filter((value): value is string => Boolean(value?.trim()))
				.join(", ");
			const label = answer.question?.trim() || answer.question_id;
			return values ? `${label} -> ${values}` : "";
		})
		.filter(Boolean)
		.join("\n");

/** Human-readable one-liner for the "captured so far" summary. */
export const describeCaptured = (captured: RoadmapIntakeCaptured): string => {
	const parts = [
		captured.product ? `Building: ${captured.product}` : "",
		captured.audience ? `For: ${captured.audience}` : "",
		captured.features?.length ? `v1: ${captured.features.join(", ")}` : "",
		captured.platform ? `On: ${captured.platform}` : "",
	].filter(Boolean);
	return parts.join(" · ");
};
