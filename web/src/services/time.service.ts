// web/src/services/time.service.ts
//
// The only client of `/api/time`. One function per endpoint, every response
// unwrapped from the `{ data }` envelope, every failure turned into a
// `TimeApiError { status, code, message, extras }`.
//
// Envelope (backend ResponseInterceptor + HttpExceptionFilter):
//   success  { data: T }              (`data` may be null: `me/running`, `me/preferences`)
//   failure  { error: { code, message, status, path, timestamp, ...extras } }
// Exports (`reports/export`, `reports/audit-export`) are raw file downloads.
//
// The axios interceptor (api/axios.ts) already raises the upgrade prompt for a
// JSON plan-limit 403; exports decode their Blob error body here and raise it
// themselves, because the interceptor cannot read a Blob.

import type { AxiosRequestConfig, AxiosResponse } from "axios";
import apiClient from "@/api/axios";
import {
	notifyPlanLimit,
	type PlanLimitInfo,
	parsePlanLimitBody,
} from "@/lib/planLimitErrors";
import {
	type ApprovalRow,
	type ApprovalsCount,
	type ApprovalsQuery,
	type ApproveBulkInput,
	type AuditExportQuery,
	type CommentRow,
	type ContextKind,
	type CreateEntryInput,
	type DateRangeQuery,
	type EntryWithWarnings,
	type LoggingForRequest,
	type LoggingForResult,
	type MyEntriesQuery,
	type MySummary,
	type MyTimeProjectsResult,
	type MyTimesheetsQuery,
	type Paged,
	type PageQuery,
	type PolicyHistoryRow,
	type ProjectLoggersResult,
	type ReportExportQuery,
	type ReportQuery,
	type ReportScopeRef,
	type ReportSummary,
	type ResolvedTimePolicy,
	type SegmentRow,
	type StartEntryInput,
	type TeamPolicyView,
	type TeamTimePolicyInput,
	TIME_CLIENT_ERROR_CODE,
	TIME_NETWORK_ERROR_CODE,
	type TimeApiErrorCode,
	type TimeEntryView,
	type TimeErrorExtras,
	type TimeExportFile,
	type TimeExportFormat,
	type TimeOverview,
	type TimesheetActionInput,
	type TimesheetDetail,
	type TimesheetRow,
	type TimesheetSummary,
	type TimesheetUserAction,
	type UpdatedEntry,
	type UpdateEntryInput,
	type UpdateTimePreferencesInput,
	type UserTimePreferences,
	type WorkItemsResult,
	type WorkspacePolicyQuery,
	type WorkspacePolicyView,
	type WorkspaceTimePolicyInput,
} from "./time.types";

const TIME_BASE = "/api/time";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── Errors ──────────────────────────────────────────────────────────────────

/** Keys the exception filter writes over the extras (D50), plus Nest's status text. */
const NON_EXTRA_KEYS = new Set([
	"code",
	"message",
	"status",
	"statusCode",
	"path",
	"timestamp",
	"error",
]);

/** What the server said, kept in axios's shape so the shared parsers still read it. */
export interface TimeErrorResponse {
	status: number;
	data: unknown;
}

/**
 * A failed `/api/time` call.
 *
 * `code` is the body's code (`TIMESHEET_LOCKED`, `TIME_INTERNAL`, `plan_limit`,
 * …), `HTTP_<status>` when the body had none (DTO validation, a missing note,
 * a pipe 404), `NETWORK_ERROR` when nothing came back and `CLIENT_ERROR` for a
 * non-HTTP throw. `message` is the server's own copy, or a plain fallback;
 * `lib/timeErrors.ts` decides what people read. `extras` are the body's other
 * keys (`options`, `timesheet_id`, `sheet_status`, …).
 *
 * `response` keeps the decoded body, so `parsePlanLimitError`,
 * `isAccessDeniedError` and `retryUnlessAccessDenied` work on it unchanged.
 */
export class TimeApiError<C extends string = TimeApiErrorCode> extends Error {
	readonly status: number;
	readonly code: C;
	readonly extras: TimeErrorExtras<C>;
	readonly response: TimeErrorResponse | undefined;

	constructor(init: {
		status: number;
		code: C;
		message: string;
		extras?: Record<string, unknown>;
		response?: TimeErrorResponse;
		cause?: unknown;
	}) {
		super(
			init.message,
			init.cause === undefined ? undefined : { cause: init.cause },
		);
		this.name = "TimeApiError";
		this.status = init.status;
		this.code = init.code;
		this.extras = (init.extras ?? {}) as TimeErrorExtras<C>;
		this.response = init.response;
	}

	/** The plan gate behind a `plan_limit` 403, else null. */
	get planLimit(): PlanLimitInfo | null {
		if (this.status !== 403 || !this.response) return null;
		return parsePlanLimitBody(this.response.data, this.status);
	}
}

/** True for a `TimeApiError`; with codes, only for one of them (and narrows `extras`). */
export function isTimeApiError(error: unknown): error is TimeApiError;
export function isTimeApiError<C extends TimeApiErrorCode>(
	error: unknown,
	...codes: C[]
): error is TimeApiError<C>;
export function isTimeApiError(
	error: unknown,
	...codes: string[]
): error is TimeApiError {
	if (!(error instanceof TimeApiError)) return false;
	return codes.length === 0 || codes.includes(error.code);
}

/** Plain fallbacks for a missing server message; display copy lives in lib/timeErrors.ts. */
const NETWORK_MESSAGE = "Proyekto couldn't reach the server. Try again.";
const HTTP_MESSAGE = "Proyekto couldn't finish this. Try again.";

/** The error object inside a body: `{ error: {...} }`, a raw `{ message: {...} }`, or the body itself. */
function errorPayload(data: unknown): Record<string, unknown> | null {
	if (!isRecord(data)) return null;
	if (isRecord(data.error)) return data.error;
	if (isRecord(data.message)) return data.message;
	return data;
}

function messageOf(payload: Record<string, unknown> | null): string | null {
	if (!payload) return null;
	const { message } = payload;
	if (typeof message === "string" && message.trim()) return message;
	if (Array.isArray(message)) {
		const parts = message.filter(
			(part): part is string => typeof part === "string" && part !== "",
		);
		if (parts.length) return parts.join("; ");
	}
	return null;
}

function parseJsonBody(data: unknown): unknown {
	if (typeof data !== "string") return data;
	try {
		return JSON.parse(data);
	} catch {
		return data;
	}
}

/**
 * Any thrown value → `TimeApiError`. Reads axios-like errors
 * (`{ response: { status, data } }`); a request that got no response is a
 * `NETWORK_ERROR` with status 0.
 */
export function toTimeApiError(error: unknown): TimeApiError {
	if (error instanceof TimeApiError) return error;

	const candidate = isRecord(error) ? error : null;
	const response =
		candidate && isRecord(candidate.response) ? candidate.response : null;

	if (response && typeof response.status === "number") {
		const status = response.status;
		const data = parseJsonBody(response.data);
		const payload = errorPayload(data);
		const code =
			payload && typeof payload.code === "string" && payload.code
				? payload.code
				: `HTTP_${status}`;
		const extras: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(payload ?? {})) {
			if (!NON_EXTRA_KEYS.has(key)) extras[key] = value;
		}
		return new TimeApiError({
			status,
			code: code as TimeApiErrorCode,
			message: messageOf(payload) ?? HTTP_MESSAGE,
			extras,
			response: { status, data },
			cause: error,
		});
	}

	const isAxios =
		candidate !== null &&
		(candidate.isAxiosError === true || candidate.request !== undefined);
	if (isAxios) {
		return new TimeApiError({
			status: 0,
			code: TIME_NETWORK_ERROR_CODE,
			message: NETWORK_MESSAGE,
			cause: error,
		});
	}

	return new TimeApiError({
		status: 0,
		code: TIME_CLIENT_ERROR_CODE,
		message:
			error instanceof Error && error.message ? error.message : HTTP_MESSAGE,
		cause: error,
	});
}

// ── Envelope and params ─────────────────────────────────────────────────────

/**
 * `{ data: T }` → T. `{ data: null }` is null, never the envelope (the trap
 * `body.data ?? body` falls into). An un-enveloped body is returned as is.
 */
export function unwrapTimeResponse<T>(body: unknown): T {
	if (isRecord(body) && Object.hasOwn(body, "data")) {
		return (body.data ?? null) as T;
	}
	return (body ?? null) as T;
}

type ParamValue = string | number | boolean;

/** Drops undefined, null and empty strings so keys and URLs stay stable. */
export function cleanParams(
	params: Record<string, unknown> | undefined,
): Record<string, ParamValue> | undefined {
	if (!params) return undefined;
	const out: Record<string, ParamValue> = {};
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === "") continue;
		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
		) {
			out[key] = value;
		} else if (value instanceof Date) {
			out[key] = value.toISOString();
		} else {
			out[key] = String(value);
		}
	}
	return Object.keys(out).length ? out : undefined;
}

const FOR_KINDS: ReadonlySet<string> = new Set<ContextKind>([
	"assignment",
	"team",
	"workspace",
	"personal",
]);
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A For choice as a `for` value. The API form is `<kind>:<id>` and
 * `personal:` (the backend's LOGGING_FOR_REF_PATTERN); the URL form (`?for=`
 * on `/time`, ux.md) writes plain `personal`. Undefined when there is no
 * choice or a governed kind has no id.
 */
export function toForParam(
	ref: LoggingForRequest | null | undefined,
	form: "api" | "url" = "api",
): string | undefined {
	if (!ref || !FOR_KINDS.has(ref.kind)) return undefined;
	if (ref.kind === "personal") return form === "url" ? "personal" : "personal:";
	if (!ref.id) return undefined;
	return `${ref.kind}:${ref.id}`;
}

/**
 * The inverse of `toForParam`: accepts `personal`, `personal:` and
 * `<assignment|team|workspace>:<uuid>`; anything else is null.
 */
export function parseForParam(
	value: string | null | undefined,
): LoggingForRequest | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed === "personal" || trimmed === "personal:") {
		return { kind: "personal", id: null };
	}
	const sep = trimmed.indexOf(":");
	if (sep <= 0) return null;
	const kind = trimmed.slice(0, sep);
	const id = trimmed.slice(sep + 1);
	if (kind === "personal" || !FOR_KINDS.has(kind) || !UUID_RE.test(id)) {
		return null;
	}
	return { kind: kind as ContextKind, id };
}

/** `?scope=<kind>:<id>`. */
export function toScopeParam(scope: ReportScopeRef): string {
	return `${scope.kind}:${scope.id}`;
}

/** The wire params of `me/entries` (also its query key). */
export function myEntriesParams(
	query: MyEntriesQuery,
): Record<string, ParamValue> {
	return (
		cleanParams({
			from: query.from,
			to: query.to,
			project_id: query.project_id,
			for: toForParam(query.for),
			page: query.page,
			limit: query.limit,
		}) ?? {}
	);
}

/** The wire params of `reports/entries|summary` (also their query keys). */
export function reportParams(
	query: ReportQuery | ReportExportQuery,
): Record<string, ParamValue> {
	const paged = query as Partial<ReportQuery>;
	return (
		cleanParams({
			scope: toScopeParam(query.scope),
			from: query.from,
			to: query.to,
			member_user_id: query.member_user_id,
			status: query.status,
			context_kind: query.context_kind,
			group_by: query.group_by,
			page: paged.page,
			limit: paged.limit,
			format: (query as ReportExportQuery).format,
		}) ?? {}
	);
}

/** The wire params of `approvals`. */
export function approvalsParams(
	query: ApprovalsQuery = {},
): Record<string, ParamValue> {
	return (
		cleanParams({
			status: query.status,
			since: query.since,
			scope_kind: query.scope_kind,
			page: query.page,
			limit: query.limit,
		}) ?? {}
	);
}

const seg = (id: string): string => encodeURIComponent(id);

// ── Write bodies ────────────────────────────────────────────────────────────

/*
 * The keys each write DTO accepts. The API refuses unknown fields
 * (`forbidNonWhitelisted`, nested `logging_for` included), and TypeScript
 * lets a spread carry extra keys (`{ ...view.policy, confirm: true }` would
 * send `sources`, `plan`, …), so these bodies are built from the lists only.
 * `Record<keyof Input, true>` keeps each list in step with its type.
 */
const START_ENTRY_KEYS: Record<keyof StartEntryInput, true> = {
	project_id: true,
	task_id: true,
	work_item: true,
	logging_for: true,
	remember: true,
	work_type: true,
	note: true,
};

const CREATE_ENTRY_KEYS: Record<keyof CreateEntryInput, true> = {
	...START_ENTRY_KEYS,
	started_at: true,
	ended_at: true,
	break_seconds: true,
	break_minutes: true,
};

const UPDATE_ENTRY_KEYS: Record<keyof UpdateEntryInput, true> = {
	task_id: true,
	work_item: true,
	started_at: true,
	ended_at: true,
	break_seconds: true,
	break_minutes: true,
	note: true,
	work_type: true,
	logging_for: true,
	expected_updated_at: true,
};

const WORKSPACE_POLICY_KEYS: Record<keyof WorkspaceTimePolicyInput, true> = {
	tracking_enabled: true,
	period_kind: true,
	week_start: true,
	timezone: true,
	period_anchor: true,
	approval_required: true,
	allow_manual_entries: true,
	retroactive_days: true,
	rounding_minutes: true,
	weekly_limit_minutes: true,
	reminder_days: true,
	hidden_presets: true,
	confirm: true,
};

const TEAM_POLICY_KEYS: Record<keyof TeamTimePolicyInput, true> = {
	period_kind: true,
	week_start: true,
	timezone: true,
	period_anchor: true,
	approval_required: true,
	approver_scope: true,
	allow_manual_entries: true,
	retroactive_days: true,
	rounding_minutes: true,
	weekly_limit_minutes: true,
	reminder_days: true,
};

/** `{ kind, id }` only (a whole `LoggingOption` would be refused); personal has a null id. */
function forBody(value: Record<string, unknown>): LoggingForRequest {
	const kind = value.kind as ContextKind;
	const id = typeof value.id === "string" ? value.id : null;
	return { kind, id: kind === "personal" ? null : id };
}

/** Only the DTO's keys; `undefined` values are left out, `null` is kept. */
function writeBody<T extends object>(
	input: T,
	keys: Record<keyof T, true>,
): Record<string, unknown> {
	const source = input as Record<string, unknown>;
	const body: Record<string, unknown> = {};
	for (const key of Object.keys(keys)) {
		if (source[key] !== undefined) body[key] = source[key];
	}
	if (isRecord(body.logging_for)) body.logging_for = forBody(body.logging_for);
	return body;
}

// ── Request ─────────────────────────────────────────────────────────────────

export type TimeMethod = "get" | "post" | "put" | "patch" | "delete";

export interface TimeRequestOptions {
	params?: Record<string, unknown>;
	body?: unknown;
	signal?: AbortSignal;
}

/**
 * One `/api/time` call: `path` is relative to `/api/time`. Unwraps the
 * envelope and throws `TimeApiError`. Exported for endpoints added later.
 */
export async function timeRequest<T>(
	method: TimeMethod,
	path: string,
	options: TimeRequestOptions = {},
): Promise<T> {
	const url = `${TIME_BASE}${path.startsWith("/") ? path : `/${path}`}`;
	const config: AxiosRequestConfig = {};
	const params = cleanParams(options.params);
	if (params) config.params = params;
	if (options.signal) config.signal = options.signal;

	let response: AxiosResponse<unknown>;
	try {
		response = await send(method, url, options.body ?? {}, config);
	} catch (error) {
		throw toTimeApiError(error);
	}
	return unwrapTimeResponse<T>(response?.data);
}

function send(
	method: TimeMethod,
	url: string,
	body: unknown,
	config: AxiosRequestConfig,
): Promise<AxiosResponse<unknown>> {
	switch (method) {
		case "get":
			return apiClient.get(url, config);
		case "delete":
			return apiClient.delete(url, config);
		case "post":
			return apiClient.post(url, body, config);
		case "put":
			return apiClient.put(url, body, config);
		case "patch":
			return apiClient.patch(url, body, config);
		default:
			return Promise.reject(new Error(`Unsupported method ${String(method)}`));
	}
}

// ── Downloads ───────────────────────────────────────────────────────────────

/**
 * The filename in a Content-Disposition header (`filename*=UTF-8''…` first,
 * then `filename="…"` or a bare token), else null. Note: the API must list
 * Content-Disposition in its CORS `exposedHeaders` for a cross-origin browser
 * to see it; without that the caller's fallback name is used.
 */
export function filenameFromDisposition(header: unknown): string | null {
	if (typeof header !== "string" || !header) return null;
	const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/.exec(header);
	if (star) {
		try {
			const decoded = decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
			if (decoded) return decoded;
		} catch {
			// fall through to the plain parameter
		}
	}
	const quoted = /filename\s*=\s*"([^"]+)"/.exec(header);
	if (quoted?.[1]) return quoted[1];
	const bare = /filename\s*=\s*([^;\s"]+)/.exec(header);
	return bare?.[1] ?? null;
}

function headerOf(headers: unknown, name: string): unknown {
	if (!headers || typeof headers !== "object") return undefined;
	const getter = (headers as { get?: unknown }).get;
	if (typeof getter === "function") {
		const value = (getter as (key: string) => unknown).call(headers, name);
		if (value !== undefined && value !== null) return value;
	}
	return (headers as Record<string, unknown>)[name];
}

/** A Blob error body, decoded to JSON (or text) so the error reads like any other. */
async function decodeBlobError(error: unknown): Promise<unknown> {
	if (!isRecord(error) || !isRecord(error.response)) return error;
	const data = error.response.data;
	if (typeof Blob === "undefined" || !(data instanceof Blob)) return error;
	let decoded: unknown;
	try {
		const text = await data.text();
		decoded = parseJsonBody(text);
	} catch {
		decoded = undefined;
	}
	return {
		isAxiosError: true,
		response: { ...error.response, data: decoded },
		cause: error,
	};
}

async function download(
	path: string,
	params: Record<string, unknown>,
	fallbackName: string,
): Promise<TimeExportFile> {
	let response: AxiosResponse<Blob>;
	try {
		response = await apiClient.get<Blob>(`${TIME_BASE}${path}`, {
			params: cleanParams(params),
			responseType: "blob",
		});
	} catch (error) {
		const timeError = toTimeApiError(await decodeBlobError(error));
		const planLimit = timeError.planLimit;
		if (planLimit) notifyPlanLimit(planLimit);
		throw timeError;
	}
	const blob = response.data;
	const contentType =
		String(headerOf(response.headers, "content-type") ?? "") ||
		(typeof Blob !== "undefined" && blob instanceof Blob ? blob.type : "") ||
		"application/octet-stream";
	return {
		blob,
		filename:
			filenameFromDisposition(
				headerOf(response.headers, "content-disposition"),
			) ?? fallbackName,
		contentType,
	};
}

function exportName(
	kind: string,
	from: string,
	to: string,
	format: TimeExportFormat,
): string {
	return `proyekto-time-${kind}-${from}-to-${to}.${format}`;
}

/** Hands a downloaded export to the browser as a file. */
export function saveTimeExport(file: TimeExportFile): void {
	const url = URL.createObjectURL(file.blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = file.filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	// Revoke after the click has been handled.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ── Pagers ──────────────────────────────────────────────────────────────────

export interface CollectPagesOptions {
	/** Page size; the API caps it at 200 (100 for approvals). */
	limit?: number;
	/** Stop after this many items (exports cap at 10,000). */
	maxItems?: number;
}

/**
 * Walks pages from 1 until the total is reached, a page comes back short or
 * empty, or `maxItems` is hit. Never loops forever on a server that
 * misreports `total`.
 */
export async function collectAllPages<T>(
	fetchPage: (page: number, limit: number) => Promise<Paged<T>>,
	options: CollectPagesOptions = {},
): Promise<T[]> {
	const limit = Math.max(1, Math.floor(options.limit ?? 200));
	const maxItems = Math.max(1, Math.floor(options.maxItems ?? 10_000));
	const items: T[] = [];
	for (let page = 1; items.length < maxItems; page += 1) {
		const result = await fetchPage(page, limit);
		const batch = Array.isArray(result?.items) ? result.items : [];
		items.push(...batch);
		const total = typeof result?.total === "number" ? result.total : 0;
		if (batch.length === 0 || batch.length < limit || items.length >= total) {
			break;
		}
	}
	return items.length > maxItems ? items.slice(0, maxItems) : items;
}

/** Every own entry in the range (`me/entries`, 200 a page). */
export function listAllMyEntries(
	query: Omit<MyEntriesQuery, "page" | "limit">,
	options?: CollectPagesOptions,
): Promise<TimeEntryView[]> {
	return collectAllPages(
		(page, limit) => timeService.listMyEntries({ ...query, page, limit }),
		{ limit: 200, ...options },
	);
}

/** Every entry of a report (`reports/entries`, 200 a page). */
export function listAllReportEntries(
	query: Omit<ReportQuery, "page" | "limit">,
	options?: CollectPagesOptions,
): Promise<TimeEntryView[]> {
	return collectAllPages(
		(page, limit) => timeService.getReportEntries({ ...query, page, limit }),
		{ limit: 200, ...options },
	);
}

/** Every approval row (`approvals`, 100 a page). */
export function listAllApprovals(
	query: Omit<ApprovalsQuery, "page" | "limit"> = {},
	options?: CollectPagesOptions,
): Promise<ApprovalRow[]> {
	return collectAllPages(
		(page, limit) => timeService.listApprovals({ ...query, page, limit }),
		{ limit: 100, ...options },
	);
}

/** Every policy change of a workspace (A7). */
export function listAllPolicyHistory(
	workspaceId: string,
	options?: CollectPagesOptions,
): Promise<PolicyHistoryRow[]> {
	return collectAllPages(
		(page, limit) =>
			timeService.getWorkspacePolicyHistory(workspaceId, { page, limit }),
		{ limit: 100, ...options },
	);
}

// ── Endpoints ───────────────────────────────────────────────────────────────

const TIMESHEET_ACTION_PATH: Record<TimesheetUserAction, string> = {
	submit: "submit",
	withdraw: "withdraw",
	approve: "approve",
	return: "return",
	reopen: "reopen",
	request_reopen: "request-reopen",
};

function act(
	timesheetId: string,
	action: TimesheetUserAction,
	input: TimesheetActionInput,
): Promise<TimesheetRow> {
	return timeRequest<TimesheetRow>(
		"post",
		`/timesheets/${seg(timesheetId)}/${TIMESHEET_ACTION_PATH[action]}`,
		{ body: input },
	);
}

/** The browser's IANA timezone, or undefined when the runtime has none. */
export function browserTimeZone(): string | undefined {
	try {
		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		return zone || undefined;
	} catch {
		return undefined;
	}
}

export const timeService = {
	// ── Project pickers ──

	/** Who this time can be for (`?at=` defaults to now; cached 30 s server-side). */
	getLoggingFor(
		projectId: string,
		options: { at?: Date | string } = {},
	): Promise<LoggingForResult> {
		return timeRequest("get", `/projects/${seg(projectId)}/logging-for`, {
			params: { at: options.at },
		});
	},

	/** Remembers the choice (422 when it is not one of the caller's options); answers the picker as it now reads. */
	setLoggingFor(
		projectId: string,
		loggingFor: LoggingForRequest,
	): Promise<LoggingForResult> {
		return timeRequest("put", `/projects/${seg(projectId)}/logging-for`, {
			body: {
				logging_for: {
					kind: loggingFor.kind,
					id: loggingFor.kind === "personal" ? null : (loggingFor.id ?? null),
				},
			},
		});
	},

	/** The resolved policy of one of the caller's options (404 for anything else). */
	getProjectPolicy(
		projectId: string,
		forRef?: LoggingForRequest | null,
	): Promise<ResolvedTimePolicy> {
		return timeRequest("get", `/projects/${seg(projectId)}/policy`, {
			params: { for: toForParam(forRef) },
		});
	},

	/** Tasks and the presets the policy shows (`access.roadmap`). */
	getWorkItems(projectId: string): Promise<WorkItemsResult> {
		return timeRequest("get", `/projects/${seg(projectId)}/work-items`);
	},

	/** A11: who can log on the project (project managers only; others 404). */
	getProjectLoggers(projectId: string): Promise<ProjectLoggersResult> {
		return timeRequest("get", `/projects/${seg(projectId)}/loggers`);
	},

	// ── Me ──

	/** The running timer, or null (guests too). */
	getRunning(): Promise<TimeEntryView | null> {
		return timeRequest("get", "/me/running");
	},

	listMyEntries(query: MyEntriesQuery): Promise<Paged<TimeEntryView>> {
		return timeRequest("get", "/me/entries", {
			params: myEntriesParams(query),
		});
	},

	/** A range over about a year is a 400. */
	getMySummary(query: DateRangeQuery): Promise<MySummary> {
		return timeRequest("get", "/me/summary", {
			params: { from: query.from, to: query.to },
		});
	},

	/** `tz` seeds a missing `user_time_preferences` row (L29). */
	getOverview(options: { tz?: string } = {}): Promise<TimeOverview> {
		return timeRequest("get", "/me/overview", { params: { tz: options.tz } });
	},

	getPreferences(): Promise<UserTimePreferences | null> {
		return timeRequest("get", "/me/preferences");
	},

	/** An omitted `week_start` keeps the stored one. */
	setPreferences(
		input: UpdateTimePreferencesInput,
	): Promise<UserTimePreferences> {
		const body: Record<string, unknown> = { timezone: input.timezone };
		if (input.week_start !== undefined) body.week_start = input.week_start;
		return timeRequest("put", "/me/preferences", { body });
	},

	/** At most the 200 newest. */
	listMyTimesheets(query: MyTimesheetsQuery = {}): Promise<TimesheetSummary[]> {
		return timeRequest("get", "/me/timesheets", {
			params: { from: query.from, to: query.to },
		});
	},

	/** A9: projects the caller can log on. */
	listMyProjects(): Promise<MyTimeProjectsResult> {
		return timeRequest("get", "/me/projects");
	},

	// ── Entries ──

	/** 201. 409 TIMER_ALREADY_RUNNING / LOGGING_FOR_REQUIRED are flow steps. */
	startEntry(input: StartEntryInput): Promise<EntryWithWarnings> {
		return timeRequest("post", "/entries/start", {
			body: writeBody(input, START_ENTRY_KEYS),
		});
	},

	/** 201. Manual time ("Add time"). */
	createEntry(input: CreateEntryInput): Promise<EntryWithWarnings> {
		return timeRequest("post", "/entries", {
			body: writeBody(input, CREATE_ENTRY_KEYS),
		});
	},

	/** The body must be empty; never gated. */
	stopEntry(entryId: string): Promise<TimeEntryView> {
		return timeRequest("post", `/entries/${seg(entryId)}/stop`, { body: {} });
	},

	pauseEntry(entryId: string): Promise<TimeEntryView> {
		return timeRequest("post", `/entries/${seg(entryId)}/pause`, { body: {} });
	},

	resumeEntry(entryId: string): Promise<TimeEntryView> {
		return timeRequest("post", `/entries/${seg(entryId)}/resume`, {
			body: {},
		});
	},

	getEntry(entryId: string): Promise<TimeEntryView> {
		return timeRequest("get", `/entries/${seg(entryId)}`);
	},

	/** `expected_updated_at` is required; a stale copy is 409 STALE_REVISION. */
	updateEntry(entryId: string, input: UpdateEntryInput): Promise<UpdatedEntry> {
		return timeRequest("patch", `/entries/${seg(entryId)}`, {
			body: writeBody(input, UPDATE_ENTRY_KEYS),
		});
	},

	/** A locked entry is 409 TIMESHEET_LOCKED. Answers no body. */
	async deleteEntry(entryId: string): Promise<void> {
		await timeRequest<unknown>("delete", `/entries/${seg(entryId)}`);
	},

	async listEntrySegments(entryId: string): Promise<SegmentRow[]> {
		const rows = await timeRequest<SegmentRow[] | null>(
			"get",
			`/entries/${seg(entryId)}/segments`,
		);
		return rows ?? [];
	},

	async listEntryComments(entryId: string): Promise<CommentRow[]> {
		const rows = await timeRequest<CommentRow[] | null>(
			"get",
			`/entries/${seg(entryId)}/comments`,
		);
		return rows ?? [];
	},

	addEntryComment(entryId: string, body: string): Promise<CommentRow> {
		return timeRequest("post", `/entries/${seg(entryId)}/comments`, {
			body: { body },
		});
	},

	// ── Timesheets ──

	getTimesheet(timesheetId: string): Promise<TimesheetDetail> {
		return timeRequest("get", `/timesheets/${seg(timesheetId)}`);
	},

	/** Any person-facing action, by name. */
	actOnTimesheet: act,

	submitTimesheet(
		timesheetId: string,
		input: TimesheetActionInput,
	): Promise<TimesheetRow> {
		return act(timesheetId, "submit", input);
	},

	withdrawTimesheet(
		timesheetId: string,
		input: TimesheetActionInput,
	): Promise<TimesheetRow> {
		return act(timesheetId, "withdraw", input);
	},

	approveTimesheet(
		timesheetId: string,
		input: TimesheetActionInput,
	): Promise<TimesheetRow> {
		return act(timesheetId, "approve", input);
	},

	/** A note is required (400 without one). */
	returnTimesheet(
		timesheetId: string,
		input: TimesheetActionInput & { note: string },
	): Promise<TimesheetRow> {
		return act(timesheetId, "return", input);
	},

	/** Decider (approved → returned, note required) or member (own auto/self sheet → open). */
	reopenTimesheet(
		timesheetId: string,
		input: TimesheetActionInput,
	): Promise<TimesheetRow> {
		return act(timesheetId, "reopen", input);
	},

	requestReopenTimesheet(
		timesheetId: string,
		input: TimesheetActionInput,
	): Promise<TimesheetRow> {
		return act(timesheetId, "request_reopen", input);
	},

	/** One RPC, all or none. A stale sheet is 409 STALE_REVISION { timesheet_id } (A10). */
	approveTimesheetsBulk(input: ApproveBulkInput): Promise<TimesheetRow[]> {
		return timeRequest("post", "/timesheets/approve-bulk", { body: input });
	},

	/** The cross-workspace queue (`submitted` by default). */
	listApprovals(query: ApprovalsQuery = {}): Promise<Paged<ApprovalRow>> {
		return timeRequest("get", "/approvals", {
			params: approvalsParams(query),
		});
	},

	getApprovalsCount(): Promise<ApprovalsCount> {
		return timeRequest("get", "/approvals/count");
	},

	// ── Reports ──

	getReportEntries(query: ReportQuery): Promise<Paged<TimeEntryView>> {
		return timeRequest("get", "/reports/entries", {
			params: reportParams(query),
		});
	},

	getReportSummary(query: ReportQuery): Promise<ReportSummary> {
		return timeRequest("get", "/reports/summary", {
			params: reportParams(query),
		});
	},

	/** `time_reports_export` on the scope's plan subject. */
	exportReport(query: ReportExportQuery): Promise<TimeExportFile> {
		const format = query.format ?? "csv";
		return download(
			"/reports/export",
			reportParams({ ...query, format }),
			exportName(query.scope.kind, query.from, query.to, format),
		);
	},

	/** `time_audit_export`: timesheet events and policy changes of one workspace. */
	exportAudit(query: AuditExportQuery): Promise<TimeExportFile> {
		const format = query.format ?? "csv";
		return download(
			"/reports/audit-export",
			{
				scope: `workspace:${query.workspace_id}`,
				from: query.from,
				to: query.to,
				format,
			},
			exportName("audit", query.from, query.to, format),
		);
	},

	// ── Policies ──

	/** A4: any member reads it (`can_edit: false`); non-members 404. */
	getWorkspacePolicy(
		workspaceId: string,
		query: WorkspacePolicyQuery = {},
	): Promise<WorkspacePolicyView> {
		return timeRequest("get", `/policies/workspaces/${seg(workspaceId)}`, {
			params: { tz: query.tz },
		});
	},

	/** Every PUT counts as a confirmation (`confirm: true` changes nothing else). */
	updateWorkspacePolicy(
		workspaceId: string,
		input: WorkspaceTimePolicyInput,
	): Promise<WorkspacePolicyView> {
		return timeRequest("put", `/policies/workspaces/${seg(workspaceId)}`, {
			body: writeBody(input, WORKSPACE_POLICY_KEYS),
		});
	},

	/** A7: managers only (others 404). Newest first. */
	getWorkspacePolicyHistory(
		workspaceId: string,
		query: PageQuery = {},
	): Promise<Paged<PolicyHistoryRow>> {
		return timeRequest(
			"get",
			`/policies/workspaces/${seg(workspaceId)}/history`,
			{ params: { page: query.page, limit: query.limit } },
		);
	},

	getTeamPolicy(teamId: string): Promise<TeamPolicyView> {
		return timeRequest("get", `/policies/teams/${seg(teamId)}`);
	},

	/** Needs `time_team_rules`; owner-only fields per D62. */
	updateTeamPolicy(
		teamId: string,
		input: TeamTimePolicyInput,
	): Promise<TeamPolicyView> {
		return timeRequest("put", `/policies/teams/${seg(teamId)}`, {
			body: writeBody(input, TEAM_POLICY_KEYS),
		});
	},

	/** Owner only, ungated; answers the policy as it now resolves. */
	deleteTeamPolicy(teamId: string): Promise<TeamPolicyView> {
		return timeRequest("delete", `/policies/teams/${seg(teamId)}`);
	},
};

export type TimeService = typeof timeService;
