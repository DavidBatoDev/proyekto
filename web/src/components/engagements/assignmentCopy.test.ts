import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import type { Engagement } from "@/services/engagement.service";
import type { EngagementAssignment } from "@/services/engagementAssignments.service";
import { TimeApiError } from "@/services/time.service";
import {
	ASSIGNMENT_COPY,
	accessNeededCopy,
	assignDialogDescription,
	assignedToast,
	assignmentAuthority,
	assignmentEmptyCopy,
	assignmentErrorCopy,
	assignmentGrantNote,
	assignmentSectionDescription,
	assignmentSpanLine,
	assignmentStatusLabel,
	assignmentWorkerName,
	endDialogDescription,
	endedToast,
	endWarningCopy,
	isAlreadyEndedError,
	localInputToIso,
	nowLocalInput,
	sortAssignments,
} from "./assignmentCopy";

const NOW = new Date("2026-10-06T04:00:00.000Z");
const TZ = "Asia/Manila";

function engagement(over: Partial<Engagement> = {}): Engagement {
	return {
		id: "eng-1",
		kind: "talent_services",
		scope_mode: "project_specific",
		status: "active",
		origin: "contract",
		activated_by_contract_id: "contract-1",
		started_at: "2026-08-01T00:00:00Z",
		ended_at: null,
		cancelled_at: null,
		status_reason: null,
		viewer_position: "hirer",
		viewer_capacity: "consultant",
		counterparty: {
			position: "provider",
			user_id: "talent-1",
			capacity: "talent",
			display_name_snapshot: "Leo Cruz",
			email_snapshot: "leo@example.com",
		},
		project_links: [],
		current_settings: null,
		current_rates: [],
		...over,
	};
}

function row(over: Partial<EngagementAssignment> = {}): EngagementAssignment {
	return {
		id: "a1",
		engagement_id: "eng-1",
		project_id: "p1",
		project_title_snapshot: "Acme Website",
		worker_user_id: "talent-1",
		worker_label: "Leo Cruz",
		client_engagement_id: null,
		talent_engagement_id: "eng-1",
		team_id: null,
		role_title: null,
		status: "active",
		started_at: "2026-10-01T01:00:00.000Z",
		ended_at: null,
		...over,
	};
}

function apiError(
	status: number,
	code: string,
	message = "x",
	extras: Record<string, unknown> = {},
) {
	return new TimeApiError({ status, code: code as never, message, extras });
}

describe("assignmentAuthority", () => {
	it("talent hirer assigns and ends the talent's work", () => {
		expect(assignmentAuthority(engagement())).toEqual({
			canAssign: true,
			canEnd: true,
			self: false,
			workerName: "Leo Cruz",
			providerSide: true,
		});
	});

	it("talent worker reads only", () => {
		expect(
			assignmentAuthority(
				engagement({
					viewer_position: "provider",
					viewer_capacity: "talent",
				}),
			),
		).toMatchObject({ canAssign: false, canEnd: false, providerSide: true });
	});

	it("client consultant assigns themselves", () => {
		expect(
			assignmentAuthority(
				engagement({ kind: "client_services", viewer_position: "provider" }),
			),
		).toEqual({
			canAssign: true,
			canEnd: true,
			self: true,
			workerName: null,
			providerSide: true,
		});
	});

	it("client hirer reads masked rows only", () => {
		expect(
			assignmentAuthority(
				engagement({ kind: "client_services", viewer_position: "hirer" }),
			),
		).toEqual({
			canAssign: false,
			canEnd: false,
			self: false,
			workerName: null,
			providerSide: false,
		});
	});

	it("an ended engagement takes no new assignment but can still end one", () => {
		expect(assignmentAuthority(engagement({ status: "ended" }))).toMatchObject({
			canAssign: false,
			canEnd: true,
		});
	});

	it("falls back to the email, then a plain phrase, for the worker", () => {
		expect(
			assignmentAuthority(
				engagement({
					counterparty: {
						position: "provider",
						user_id: "t",
						capacity: "talent",
						display_name_snapshot: null,
						email_snapshot: "leo@example.com",
					},
				}),
			).workerName,
		).toBe("leo@example.com");
		expect(
			assignmentAuthority(engagement({ counterparty: null })).workerName,
		).toBe("this person");
	});
});

describe("ux.md sentences", () => {
	it("asks which client agreement", () => {
		expect(ASSIGNMENT_COPY.clientQuestion).toBe(
			"Which client agreement is this work for?",
		);
	});

	it("asks for a project admin when access is needed (L25)", () => {
		expect(accessNeededCopy("Leo")).toBe("Ask a project admin to add Leo.");
	});

	it("warns that ending stops the running timer (L37)", () => {
		expect(endWarningCopy("Leo")).toBe(
			"Ending this stops Leo's running timer at the end time.",
		);
		expect(endWarningCopy(null)).toBe(
			"Ending this stops your running timer at the end time.",
		);
	});
});

describe("section copy", () => {
	it("describes the section per seat", () => {
		expect(assignmentSectionDescription(engagement())).toBe(
			"The projects Leo Cruz works on under this agreement.",
		);
		expect(
			assignmentSectionDescription(engagement({ viewer_position: "provider" })),
		).toBe("The projects you're assigned to under this agreement.");
		expect(
			assignmentSectionDescription(
				engagement({ kind: "client_services", viewer_position: "provider" }),
			),
		).toBe(
			"The projects you and the people you hired work on under this agreement.",
		);
		expect(
			assignmentSectionDescription(
				engagement({ kind: "client_services", viewer_position: "hirer" }),
			),
		).toBe("Who works on which of your projects under this agreement.");
	});

	it("says what to do when nothing is assigned", () => {
		expect(assignmentEmptyCopy(engagement())).toBe(
			"Assign Leo Cruz to a project so they can log time under this agreement.",
		);
		expect(
			assignmentEmptyCopy(
				engagement({ kind: "client_services", viewer_position: "provider" }),
			),
		).toBe("Assign yourself to a project to log time under this agreement.");
		expect(
			assignmentEmptyCopy(
				engagement({ kind: "client_services", viewer_position: "hirer" }),
			),
		).toBe("No one is assigned to a project under this agreement yet.");
	});

	it("explains access before assigning", () => {
		const talent = assignmentAuthority(engagement());
		expect(assignmentGrantNote(talent)).toBe(
			"If you manage the project's people, Leo Cruz is added to it as an editor.",
		);
		expect(assignDialogDescription(talent)).toBe(
			"Pick the project Leo Cruz works on under this agreement.",
		);
		const self = assignmentAuthority(
			engagement({ kind: "client_services", viewer_position: "provider" }),
		);
		expect(assignmentGrantNote(self)).toBe(
			"You need editor access on the project to log time there.",
		);
		expect(assignDialogDescription(self)).toBe(
			"Pick the project you work on under this agreement.",
		);
	});

	it("toasts and end descriptions", () => {
		expect(assignedToast("Leo Cruz", "Acme Website")).toBe(
			"Leo Cruz is assigned to Acme Website.",
		);
		expect(assignedToast(null, "Acme Website")).toBe(
			"You're assigned to Acme Website.",
		);
		expect(endedToast("Acme Website")).toBe(
			"The assignment to Acme Website has ended.",
		);
		expect(endDialogDescription("Leo Cruz", "Acme Website")).toBe(
			"After it ends, Leo Cruz can't log time on Acme Website under this agreement.",
		);
		expect(endDialogDescription(null, "Acme Website")).toBe(
			"After it ends, you can't log time on Acme Website under this agreement.",
		);
	});
});

describe("rows", () => {
	it("names the viewer 'You' and keeps the masked label", () => {
		expect(assignmentWorkerName(row(), "talent-1")).toBe("You");
		expect(assignmentWorkerName(row(), "someone-else")).toBe("Leo Cruz");
		expect(
			assignmentWorkerName(
				row({ worker_user_id: null, worker_label: "Delivery team" }),
				null,
			),
		).toBe("Delivery team");
	});

	it("labels statuses", () => {
		expect(assignmentStatusLabel("active")).toBe("Active");
		expect(assignmentStatusLabel("ended")).toBe("Ended");
		expect(assignmentStatusLabel("cancelled")).toBe("Cancelled");
	});

	it("spans in the reader's timezone, the year only when it isn't this one", () => {
		expect(assignmentSpanLine(row(), { now: NOW, timeZone: TZ })).toBe(
			"Since Oct 1",
		);
		expect(
			assignmentSpanLine(
				row({
					status: "ended",
					started_at: "2025-12-30T01:00:00.000Z",
					ended_at: "2026-10-05T16:30:00.000Z",
				}),
				{ now: NOW, timeZone: TZ },
			),
		).toBe("Dec 30, 2025 – Oct 6");
	});

	it("sorts active first, then the latest end", () => {
		const a = row({ id: "a" });
		const b = row({
			id: "b",
			status: "ended",
			ended_at: "2026-09-01T00:00:00.000Z",
		});
		const c = row({
			id: "c",
			status: "ended",
			ended_at: "2026-09-20T00:00:00.000Z",
		});
		// No end: ordered by its start instead.
		const d = row({
			id: "d",
			status: "cancelled",
			started_at: "2026-08-01T00:00:00.000Z",
			ended_at: null,
		});
		const { active, past } = sortAssignments([b, a, c, d]);
		expect(active.map((r) => r.id)).toEqual(["a"]);
		expect(past.map((r) => r.id)).toEqual(["c", "b", "d"]);
	});
});

describe("datetime-local", () => {
	it("reads an empty or broken value as now (undefined)", () => {
		expect(localInputToIso("")).toBeUndefined();
		expect(localInputToIso("   ")).toBeUndefined();
		expect(localInputToIso("not a date")).toBeUndefined();
	});

	it("turns a local value into an instant", () => {
		const iso = localInputToIso("2026-10-05T09:30");
		expect(iso).toBe(new Date("2026-10-05T09:30").toISOString());
	});

	it("formats now for the inputs' max", () => {
		expect(nowLocalInput(new Date(2026, 9, 6, 8, 5))).toBe("2026-10-06T08:05");
	});
});

describe("assignmentErrorCopy", () => {
	it("asks the client question for ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED", () => {
		expect(
			assignmentErrorCopy(
				apiError(422, "ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED"),
				{ operation: "create", workerName: "Leo" },
			),
		).toBe("Which client agreement is this work for?");
	});

	it("names the worker on ASSIGNMENT_ALREADY_ACTIVE", () => {
		const err = apiError(409, "ASSIGNMENT_ALREADY_ACTIVE");
		expect(
			assignmentErrorCopy(err, { operation: "create", workerName: "Leo" }),
		).toBe("Leo is already assigned to this project under this agreement.");
		expect(
			assignmentErrorCopy(err, { operation: "create", workerName: null }),
		).toBe("You're already assigned to this project under this agreement.");
	});

	it("covers the other assignment refusals", () => {
		expect(
			assignmentErrorCopy(apiError(409, "ASSIGNMENT_NOT_ACTIVE"), {
				operation: "end",
			}),
		).toBe("This assignment has already ended.");
		expect(
			assignmentErrorCopy(apiError(403, "ASSIGNMENT_PROJECT_LINK_REQUIRED"), {
				operation: "create",
			}),
		).toBe("Ask a project admin to add this agreement to the project first.");
		expect(
			assignmentErrorCopy(apiError(403, "NO_LOGGING_CONTEXT"), {
				operation: "create",
			}),
		).toBe(
			"You can't log time on this project yet. Ask a project admin for editor access.",
		);
		expect(
			assignmentErrorCopy(apiError(422, "RETROACTIVE_WINDOW"), {
				operation: "create",
			}),
		).toBe(
			"This start is further back than time can be added under this agreement.",
		);
	});

	it("uses the ux.md row for ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER", () => {
		expect(
			assignmentErrorCopy(
				apiError(422, "ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER", "raw"),
				{ operation: "create" },
			),
		).toBe(
			"This agreement's hirer doesn't deliver the client agreement on this project.",
		);
	});

	it("keeps the server's fixed sentences for the guard codes and plain 4xx", () => {
		expect(
			assignmentErrorCopy(
				apiError(
					422,
					"TALENT_ENGAGEMENT_PROJECT_NOT_LINKED",
					"This agreement covers a different project.",
				),
				{ operation: "create" },
			),
		).toBe("This agreement covers a different project.");
		expect(
			assignmentErrorCopy(
				apiError(
					403,
					"HTTP_403",
					"Only the agreement's hirer can end this assignment.",
				),
				{ operation: "end" },
			),
		).toBe("Only the agreement's hirer can end this assignment.");
		expect(
			assignmentErrorCopy(
				apiError(400, "HTTP_400", "An assignment can't end in the future."),
				{ operation: "end" },
			),
		).toBe("An assignment can't end in the future.");
	});

	it("never shows validator text", () => {
		expect(
			assignmentErrorCopy(
				apiError(
					400,
					"HTTP_400",
					"role_title must be shorter than or equal to 120 characters",
				),
				{ operation: "create" },
			),
		).toBe("Proyekto couldn't finish this. Check the details and try again.");
	});

	it("says what a 404 is about", () => {
		const notFound = apiError(404, "HTTP_404", "Project not found");
		expect(assignmentErrorCopy(notFound, { operation: "create" })).toBe(
			"This project doesn't exist or you can't open it.",
		);
		expect(assignmentErrorCopy(notFound, { operation: "end" })).toBe(
			"This assignment doesn't exist or you can't open it.",
		);
		expect(assignmentErrorCopy(notFound, { operation: "list" })).toBe(
			"This engagement doesn't exist or you can't open it.",
		);
	});

	it("reads network failures", () => {
		expect(
			assignmentErrorCopy(apiError(0, "NETWORK_ERROR"), { operation: "list" }),
		).toBe(
			"Proyekto couldn't reach the server. Check your connection and try again.",
		);
	});

	it("knows an already-ended end", () => {
		expect(isAlreadyEndedError(apiError(409, "ASSIGNMENT_NOT_ACTIVE"))).toBe(
			true,
		);
		expect(
			isAlreadyEndedError(
				apiError(409, "ENGAGEMENT_ASSIGNMENT_STATUS_INVALID"),
			),
		).toBe(true);
		expect(isAlreadyEndedError(apiError(400, "HTTP_400"))).toBe(false);
	});
});
