import type { ProjectBriefField } from "./types";

export const EMPTY_CUSTOM_FIELDS: ProjectBriefField[] = [];

type BriefStateInput =
	| {
			project_summary?: string | null;
			custom_fields?: ProjectBriefField[] | null;
	  }
	| null
	| undefined;

export function getOverviewBriefState(brief: BriefStateInput): {
	projectSummary: string | null;
	customFields: ProjectBriefField[];
} {
	return {
		projectSummary: brief?.project_summary ?? null,
		customFields: brief?.custom_fields ?? EMPTY_CUSTOM_FIELDS,
	};
}

export function areProjectBriefFieldsEqual(
	a: ProjectBriefField[],
	b: ProjectBriefField[],
) {
	if (a.length !== b.length) return false;
	return a.every((field, index) => {
		const other = b[index];
		return (
			field.key === other?.key &&
			field.value === other?.value &&
			field.position === other?.position
		);
	});
}
