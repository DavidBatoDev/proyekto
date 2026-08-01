import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * End-to-end regression for the Phase 0 authz-scope refactor.
 *
 * The assert*Permission walkers now RETURN the resolved
 * { roadmapId, projectId, ownerId, permissions } instead of void, and every
 * roadmap write service was rewired to reuse it rather than re-query. Two
 * changes in there cannot be proven by unit tests, because the unit suite
 * stubs Supabase:
 *
 *   1. getTaskScope resolves task -> feature -> roadmap in ONE PostgREST query
 *      via the embed `feature:roadmap_features!roadmap_tasks_feature_id_fkey`.
 *      If that FK alias or the to-one/array shape is wrong at runtime, EVERY
 *      task write and task comment 404s — and all 553 unit tests still pass.
 *
 *   2. `roadmap.assign` is now answered in memory from the already-resolved
 *      ProjectPermissions instead of a second full authz walk. Only a real run
 *      proves the live permission object actually carries roadmap.assign where
 *      the code looks for it.
 *
 * So this drives the REAL backend over HTTP with a REAL session token and
 * touches every refactored walker. Self-cleaning: everything it creates is
 * deleted in reverse order at the end.
 *
 *   cd web
 *   npx playwright test playwright/tests/roadmap-write-scope.spec.ts --project=chromium-user
 */

const ROADMAP_ID = "5ebdbb85-87a6-4685-aba4-fcf7f2283afe";
const PROJECT_ID = "69d405c9-1eee-4b0f-91b4-2e677ba10c23";
const BACKEND = (process.env.VITE_API_URL || "http://localhost:8001").replace(
	/\/$/,
	"",
);
const APP_URL = `/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView`;
const TAG = `pw-scope-${Date.now()}`;

/** ResponseInterceptor wraps success payloads in an envelope; tolerate both. */
function unwrap<T = any>(body: any): T {
	return (body && typeof body === "object" && "data" in body ? body.data : body) as T;
}

type Call = { label: string; status: number; ms: number };

test("Phase 0: every roadmap write path still resolves through the shared scope", async ({
	page,
}) => {
	test.setTimeout(180_000);

	// ── 1. Read path through the browser ────────────────────────────────────
	// assertViewPermission now shares one roadmap-meta read between the view
	// verdict and the returned scope; if that broke, the canvas never loads.
	await page.goto(APP_URL);
	await expect(
		page.locator(".react-flow"),
		"roadmap canvas should render (assertViewPermission read path)",
	).toBeVisible({ timeout: 45_000 });

	// ── 2. Real session token + caller id ───────────────────────────────────
	const token = await page.evaluate(() => {
		for (const k of Object.keys(localStorage)) {
			if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
				try {
					return JSON.parse(localStorage.getItem(k) as string)?.access_token ?? null;
				} catch {
					return null;
				}
			}
		}
		return null;
	});
	expect(token, "a Supabase session token must be present").toBeTruthy();

	const selfId = JSON.parse(
		Buffer.from((token as string).split(".")[1], "base64").toString("utf8"),
	).sub as string;
	expect(selfId, "token should carry a subject claim").toBeTruthy();

	const api: APIRequestContext = page.request;
	const auth = { Authorization: `Bearer ${token}` };
	const calls: Call[] = [];

	async function call(
		label: string,
		method: "get" | "post" | "patch" | "delete",
		path: string,
		data?: unknown,
	) {
		const started = Date.now();
		const res = await api[method](`${BACKEND}${path}`, {
			headers: auth,
			...(data === undefined ? {} : { data }),
		});
		const ms = Date.now() - started;
		calls.push({ label, status: res.status(), ms });
		let body: any = null;
		try {
			body = await res.json();
		} catch {
			/* 204s have no body */
		}
		return { res, body: unwrap(body), status: res.status() };
	}

	/** Assert 2xx, surfacing the server's error envelope when it is not. */
	function ok(label: string, r: { status: number; body: any }) {
		expect(
			r.status,
			`${label} -> ${r.status} ${JSON.stringify(r.body)?.slice(0, 300)}`,
		).toBeLessThan(300);
	}

	const created: Array<{ kind: string; path: string }> = [];

	try {
		// ── 3. Epic: create / update / comment ────────────────────────────────
		// assertRoadmapPermission + assertEpicPermission + assertEpicCommentPermission
		const epic = await call("epic.create", "post", "/api/epics", {
			roadmap_id: ROADMAP_ID,
			title: `${TAG}-epic`,
		});
		ok("epic.create", epic);
		const epicId = epic.body?.id as string;
		expect(epicId, "epic id").toBeTruthy();
		created.push({ kind: "epic", path: `/api/epics/${epicId}` });

		ok(
			"epic.update",
			await call("epic.update", "patch", `/api/epics/${epicId}`, {
				title: `${TAG}-epic-renamed`,
			}),
		);
		ok(
			"epic.comment",
			await call("epic.comment", "post", `/api/epics/${epicId}/comments`, {
				content: `${TAG} epic comment`,
			}),
		);

		// ── 4. Feature: create / update / comment / reorder ───────────────────
		// assertFeaturePermission + assertFeatureCommentPermission
		// `position` is REQUIRED here: unlike EpicsRepository.create, which
		// computes a position, FeaturesRepository.create inserts the DTO as-is
		// and the column is NOT NULL — omitting it 500s.
		const feature = await call("feature.create", "post", "/api/features", {
			roadmap_id: ROADMAP_ID,
			epic_id: epicId,
			title: `${TAG}-feature`,
			position: 0,
		});
		ok("feature.create", feature);
		const featureId = feature.body?.id as string;
		expect(featureId, "feature id").toBeTruthy();

		ok(
			"feature.update",
			await call("feature.update", "patch", `/api/features/${featureId}`, {
				title: `${TAG}-feature-renamed`,
			}),
		);
		ok(
			"feature.comment",
			await call("feature.comment", "post", `/api/features/${featureId}/comments`, {
				content: `${TAG} feature comment`,
			}),
		);
		ok(
			"feature.reorder",
			await call("feature.reorder", "patch", "/api/features/reorder", {
				epic_id: epicId,
				items: [{ id: featureId, position: 0 }],
			}),
		);

		// ── 5. Task: the getTaskScope embed ──────────────────────────────────
		// create -> update -> status -> ASSIGN -> comment -> reorder.
		const task = await call("task.create", "post", "/api/tasks", {
			feature_id: featureId,
			title: `${TAG}-task`,
			position: 0,
		});
		ok("task.create", task);
		const taskId = task.body?.id as string;
		expect(taskId, "task id").toBeTruthy();

		// Each of these walks assertTaskPermission -> getTaskScope. A broken FK
		// embed surfaces here as 404 "Task not found" / "Feature not found".
		ok(
			"task.update.title",
			await call("task.update.title", "patch", `/api/tasks/${taskId}`, {
				title: `${TAG}-task-renamed`,
			}),
		);
		ok(
			"task.update.status",
			await call("task.update.status", "patch", `/api/tasks/${taskId}`, {
				status: "in_progress",
			}),
		);

		// THE crown-jewel assertion: the in-memory roadmap.assign check that
		// replaced a second full authz walk.
		const assigned = await call(
			"task.assign",
			"patch",
			`/api/tasks/${taskId}`,
			{ assignee_ids: [selfId] },
		);
		expect(
			assigned.status,
			`task.assign -> ${assigned.status} ${JSON.stringify(assigned.body)?.slice(0, 300)}. ` +
				"A 403 here means the in-memory getPermission(ctx.permissions, 'roadmap.assign') " +
				"check disagrees with the live resolved permission set.",
		).toBeLessThan(300);

		const assignees: string[] = (assigned.body?.assignees ?? [])
			.map((a: any) => a?.id)
			.filter(Boolean);
		expect(
			assignees.length > 0 || assigned.body?.assignee_id === selfId,
			"the assignment must actually persist, not just return 2xx",
		).toBeTruthy();

		// assertTaskCommentPermission -> getTaskScope (the other embed caller).
		ok(
			"task.comment",
			await call("task.comment", "post", `/api/tasks/${taskId}/comments`, {
				content: `${TAG} task comment`,
			}),
		);
		ok(
			"task.reorder",
			await call("task.reorder", "patch", "/api/tasks/reorder", {
				feature_id: featureId,
				items: [{ id: taskId, position: 0 }],
			}),
		);

		// Task read path (assertViewPermission via taskId ref).
		ok("task.read", await call("task.read", "get", `/api/tasks/${taskId}`));

		// ── 6. Milestone: assertMilestonePermission ──────────────────────────
		const milestone = await call(
			"milestone.create",
			"post",
			`/api/roadmaps/${ROADMAP_ID}/milestones`,
			{
				title: `${TAG}-milestone`,
				target_date: new Date(Date.now() + 7 * 864e5).toISOString(),
			},
		);
		ok("milestone.create", milestone);
		const milestoneId = milestone.body?.id as string;

		if (milestoneId) {
			ok(
				"milestone.update",
				await call(
					"milestone.update",
					"patch",
					`/api/roadmaps/milestones/${milestoneId}`,
					{ title: `${TAG}-milestone-renamed` },
				),
			);
			ok(
				"milestone.reorder",
				await call(
					"milestone.reorder",
					"patch",
					`/api/roadmaps/milestones/${milestoneId}/reorder`,
					{ position: 0 },
				),
			);
			ok(
				"milestone.delete",
				await call(
					"milestone.delete",
					"delete",
					`/api/roadmaps/milestones/${milestoneId}`,
				),
			);
		}

		// ── 7. Task delete (resolves scope BEFORE the row disappears) ────────
		ok("task.delete", await call("task.delete", "delete", `/api/tasks/${taskId}`));
		ok(
			"feature.delete",
			await call("feature.delete", "delete", `/api/features/${featureId}`),
		);

		// ── 8. The activity endpoint that will back the Logs page ────────────
		const activity = await call(
			"activity.list",
			"get",
			`/api/projects/${PROJECT_ID}/activity?limit=5`,
		);
		ok("activity.list", activity);
		expect(
			Array.isArray(activity.body),
			`activity should return an array, got ${JSON.stringify(activity.body)?.slice(0, 200)}`,
		).toBeTruthy();
		console.log(
			`[activity] ${activity.body.length} row(s); actions: ` +
				activity.body.map((r: any) => r.action).join(", "),
		);
	} finally {
		// Reverse-order cleanup; best-effort so one failure cannot leak the rest.
		for (const item of created.reverse()) {
			const res = await api
				.delete(`${BACKEND}${item.path}`, { headers: auth })
				.catch(() => null);
			console.log(`[cleanup] ${item.kind} -> ${res ? res.status() : "error"}`);
		}

		console.log("\n── write-path matrix ──");
		for (const c of calls) {
			console.log(`  ${String(c.status).padEnd(4)} ${c.ms.toString().padStart(5)}ms  ${c.label}`);
		}
	}
});
