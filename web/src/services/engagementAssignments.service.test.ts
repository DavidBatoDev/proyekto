import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
}));

vi.mock("@/api/axios", () => ({ default: client }));

import {
	ASSIGNMENT_END_REASON_MAX,
	ASSIGNMENT_ROLE_TITLE_MAX,
	clientEngagementChoices,
	createAssignmentBody,
	type EngagementAssignment,
	endAssignmentBody,
	engagementAssignmentKeys,
	engagementAssignmentsService,
} from "./engagementAssignments.service";
import { TimeApiError } from "./time.service";

const ENG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ASSIGNMENT = "33333333-3333-4333-8333-333333333333";
const CLIENT_A = "44444444-4444-4444-8444-444444444444";
const CLIENT_B = "55555555-5555-4555-8555-555555555555";

/** What axios rejects with once HttpExceptionFilter has shaped the body. */
function httpError(status: number, error: Record<string, unknown>) {
	return Object.assign(new Error(`Request failed with status code ${status}`), {
		isAxiosError: true,
		response: {
			status,
			data: {
				error: {
					...error,
					status,
					path: `/api/engagements/${ENG}/assignments`,
					timestamp: "2026-10-06T00:00:00.000Z",
				},
			},
		},
	});
}

const ok = (data: unknown) => ({ data: { data } });

function row(over: Partial<EngagementAssignment> = {}): EngagementAssignment {
	return {
		id: ASSIGNMENT,
		engagement_id: ENG,
		project_id: PROJECT,
		project_title_snapshot: "Acme Website",
		worker_user_id: "talent-1",
		worker_label: "Leo Cruz",
		client_engagement_id: null,
		talent_engagement_id: ENG,
		team_id: null,
		role_title: null,
		status: "active",
		started_at: "2026-10-01T00:00:00.000Z",
		ended_at: null,
		...over,
	};
}

beforeEach(() => {
	client.get.mockReset();
	client.post.mockReset();
});

describe("engagementAssignmentsService.list", () => {
	it("GETs the engagement's assignments and unwraps the envelope", async () => {
		client.get.mockResolvedValue(ok([row()]));
		await expect(engagementAssignmentsService.list(ENG)).resolves.toEqual([
			row(),
		]);
		expect(client.get).toHaveBeenCalledWith(
			`/api/engagements/${ENG}/assignments`,
		);
	});

	it("reads a null body as an empty list", async () => {
		client.get.mockResolvedValue(ok(null));
		await expect(engagementAssignmentsService.list(ENG)).resolves.toEqual([]);
	});

	it("escapes the id", async () => {
		client.get.mockResolvedValue(ok([]));
		await engagementAssignmentsService.list("a/b");
		expect(client.get).toHaveBeenCalledWith(
			"/api/engagements/a%2Fb/assignments",
		);
	});

	it("turns a party-only 404 into a TimeApiError", async () => {
		client.get.mockRejectedValue(
			httpError(404, { message: "Engagement not found", error: "Not Found" }),
		);
		const err = await engagementAssignmentsService
			.list(ENG)
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(TimeApiError);
		expect(err).toMatchObject({ status: 404, code: "HTTP_404" });
		expect((err as TimeApiError).extras).toEqual({});
	});
});

describe("engagementAssignmentsService.create", () => {
	it("POSTs DTO keys only, trimmed, with blanks dropped", async () => {
		client.post.mockResolvedValue(ok({ ...row(), access_needed: true }));
		const result = await engagementAssignmentsService.create(ENG, {
			project_id: PROJECT,
			role_title: "  Frontend developer  ",
			started_at: undefined,
			client_engagement_id: "",
			...({ engagement: { id: ENG }, extra: 1 } as object),
		});
		expect(result.access_needed).toBe(true);
		expect(client.post).toHaveBeenCalledWith(
			`/api/engagements/${ENG}/assignments`,
			{ project_id: PROJECT, role_title: "Frontend developer" },
		);
	});

	it("sends the chosen client agreement and the start", async () => {
		client.post.mockResolvedValue(ok({ ...row(), access_needed: false }));
		await engagementAssignmentsService.create(ENG, {
			project_id: PROJECT,
			client_engagement_id: CLIENT_A,
			started_at: "2026-10-05T01:00:00.000Z",
			role_title: "   ",
		});
		expect(client.post.mock.calls[0][1]).toEqual({
			project_id: PROJECT,
			client_engagement_id: CLIENT_A,
			started_at: "2026-10-05T01:00:00.000Z",
		});
	});

	it("keeps the 422 extras for the client-agreement question", async () => {
		client.post.mockRejectedValue(
			httpError(422, {
				code: "ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED",
				message: "Choose the client agreement this work belongs to.",
				client_engagements: [
					{ id: CLIENT_A, label: "Acme Corp" },
					{ id: CLIENT_B, label: "Globex" },
				],
			}),
		);
		const err = await engagementAssignmentsService
			.create(ENG, { project_id: PROJECT })
			.catch((e: unknown) => e);
		expect(err).toMatchObject({
			status: 422,
			code: "ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED",
		});
		expect(clientEngagementChoices(err)).toEqual([
			{ id: CLIENT_A, label: "Acme Corp" },
			{ id: CLIENT_B, label: "Globex" },
		]);
	});

	it("keeps a bare assignment code", async () => {
		client.post.mockRejectedValue(
			httpError(409, {
				code: "ASSIGNMENT_ALREADY_ACTIVE",
				message:
					"This person is already assigned to this project under this agreement.",
				error: "Conflict",
			}),
		);
		const err = await engagementAssignmentsService
			.create(ENG, { project_id: PROJECT })
			.catch((e: unknown) => e);
		expect(err).toMatchObject({
			status: 409,
			code: "ASSIGNMENT_ALREADY_ACTIVE",
			message:
				"This person is already assigned to this project under this agreement.",
		});
	});

	it("is a NETWORK_ERROR when nothing came back", async () => {
		client.post.mockRejectedValue(
			Object.assign(new Error("Network Error"), {
				isAxiosError: true,
				request: {},
			}),
		);
		const err = await engagementAssignmentsService
			.create(ENG, { project_id: PROJECT })
			.catch((e: unknown) => e);
		expect(err).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
	});
});

describe("engagementAssignmentsService.end", () => {
	it("POSTs an empty body to end it now", async () => {
		client.post.mockResolvedValue(
			ok(row({ status: "ended", ended_at: "2026-10-06T00:00:00.000Z" })),
		);
		const result = await engagementAssignmentsService.end(ENG, ASSIGNMENT);
		expect(result.status).toBe("ended");
		expect(client.post).toHaveBeenCalledWith(
			`/api/engagements/${ENG}/assignments/${ASSIGNMENT}/end`,
			{},
		);
	});

	it("sends the end and a trimmed reason", async () => {
		client.post.mockResolvedValue(ok(row({ status: "ended" })));
		await engagementAssignmentsService.end(ENG, ASSIGNMENT, {
			ended_at: "2026-10-05T09:00:00.000Z",
			reason: "  The work is done ",
		});
		expect(client.post.mock.calls[0][1]).toEqual({
			ended_at: "2026-10-05T09:00:00.000Z",
			reason: "The work is done",
		});
	});
});

describe("bodies", () => {
	it("caps the role and the reason at the DTO maxima", () => {
		expect(
			createAssignmentBody({
				project_id: PROJECT,
				role_title: "x".repeat(200),
			}).role_title,
		).toHaveLength(ASSIGNMENT_ROLE_TITLE_MAX);
		expect(endAssignmentBody({ reason: "y".repeat(800) }).reason).toHaveLength(
			ASSIGNMENT_END_REASON_MAX,
		);
	});

	it("keeps the optional worker and team when given", () => {
		expect(
			createAssignmentBody({
				project_id: PROJECT,
				worker_user_id: "talent-1",
				team_id: "team-1",
			}),
		).toEqual({
			project_id: PROJECT,
			worker_user_id: "talent-1",
			team_id: "team-1",
		});
	});
});

describe("clientEngagementChoices", () => {
	it("is null for any other error", () => {
		expect(
			clientEngagementChoices(
				new TimeApiError({
					status: 409,
					code: "ASSIGNMENT_ALREADY_ACTIVE" as never,
					message: "x",
				}),
			),
		).toBeNull();
		expect(clientEngagementChoices(new Error("boom"))).toBeNull();
	});

	it("skips malformed items, collapses duplicates and labels blanks", () => {
		const err = new TimeApiError({
			status: 422,
			code: "ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED",
			message: "x",
			extras: {
				client_engagements: [
					{ id: CLIENT_A, label: "Acme Corp" },
					{ id: CLIENT_A, label: "Acme again" },
					{ id: CLIENT_B, label: "  " },
					{ label: "no id" },
					"junk",
					null,
				],
			},
		});
		expect(clientEngagementChoices(err)).toEqual([
			{ id: CLIENT_A, label: "Acme Corp" },
			{ id: CLIENT_B, label: "Client agreement" },
		]);
	});

	it("is an empty list when the extras are missing", () => {
		const err = new TimeApiError({
			status: 422,
			code: "ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED",
			message: "x",
		});
		expect(clientEngagementChoices(err)).toEqual([]);
	});
});

describe("engagementAssignmentKeys", () => {
	it("nests the list under the engagement detail key", () => {
		expect(engagementAssignmentKeys.list(ENG)).toEqual([
			"engagement",
			ENG,
			"assignments",
		]);
		expect(engagementAssignmentKeys.list(ENG).slice(0, 2)).toEqual([
			"engagement",
			ENG,
		]);
	});

	it("scopes the placeable projects to the user", () => {
		expect(engagementAssignmentKeys.placeableProjects("u1")).toEqual([
			"engagement-assignments",
			"placeable-projects",
			"u1",
		]);
		expect(engagementAssignmentKeys.placeableProjects(null)[2]).toBe(
			"anonymous",
		);
	});
});
