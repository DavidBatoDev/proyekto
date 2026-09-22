/**
 * The documentation site's table of contents.
 *
 * Metadata lives here rather than in markdown frontmatter, and the reason is
 * bundling. The sidebar, the home page, the search index and the Popular grid
 * all need metadata for EVERY article before a single body renders. With
 * frontmatter the only way to get it is an eager `?raw` glob, which would pull
 * all 47 articles' prose into the initial chunk for someone who reads one page.
 * Here, metadata is one small eager module and bodies stay a lazy glob fetched
 * per article (see `docsContent.ts`).
 *
 * It also buys type safety — a missing description is a build error, not a
 * blank card — and it lets `docs.manifest.test.ts` assert the cross-link rules.
 *
 * Articles carry NO `# Title` heading: the page renders `title` from here, so a
 * title can only ever be wrong in one place.
 */

export type DocSectionId =
	| "start-here"
	| "account-and-apps"
	| "workspaces-and-plans"
	| "projects"
	| "roadmaps-and-work"
	| "ai-assistant"
	| "chat-and-meetings"
	| "delivery-governance"
	| "teams-time-and-rates"
	| "clients-and-marketplace";

export interface DocSection {
	id: DocSectionId;
	title: string;
	/** One line, shown on the home page's section card. */
	purpose: string;
	order: number;
	/** Only "Start here" is flat — a collapsed first section is a dead end. */
	collapsible: boolean;
}

export interface DocArticle {
	slug: string;
	section: DocSectionId;
	/** Within the section. Spaced by 10 so an insert never renumbers siblings. */
	order: number;
	title: string;
	/** One sentence. Used on cards, in search results, and as the meta description. */
	description: string;
	updated: string;
	/** Exactly four articles may set this; the manifest test enforces it. */
	popular?: true;
	/**
	 * "web" hides the article in the installed app. The whole
	 * clients-and-marketplace section is already hidden by a platformSurfaces
	 * prefix rule; this flag is what makes the sidebar and home page agree.
	 */
	surface?: "web";
	/** Renders the plan callout (R1) naming the tier and the limit invariant. */
	plan?: "pro" | "business" | "enterprise";
	/** Renders the "may not be enabled" callout (R2) for flag-gated features. */
	flagged?: true;
	/** The section's landing article. Exactly one per section. */
	hub?: true;
	/** Search synonyms that do not appear in the prose. */
	keywords?: string[];
	/** Slugs, for the Related footer. Validated by the manifest test. */
	related?: string[];
}

export const DOC_SECTIONS: DocSection[] = [
	{
		id: "start-here",
		title: "Start here",
		purpose: "What Proyekto is, the vocabulary, and where everything lives.",
		order: 10,
		collapsible: false,
	},
	{
		id: "account-and-apps",
		title: "Your account & apps",
		purpose:
			"The settings that follow you everywhere, plus the mobile app and MCP.",
		order: 20,
		collapsible: true,
	},
	{
		id: "workspaces-and-plans",
		title: "Workspaces & plans",
		purpose: "The billing container, its members, and what each tier includes.",
		order: 30,
		collapsible: true,
	},
	{
		id: "projects",
		title: "Projects",
		purpose: "The delivery container and who is allowed inside it.",
		order: 40,
		collapsible: true,
	},
	{
		id: "roadmaps-and-work",
		title: "Roadmaps & work",
		purpose:
			"The plan itself — epics, features, tasks, and the four views of them.",
		order: 50,
		collapsible: true,
	},
	{
		id: "ai-assistant",
		title: "AI assistant",
		purpose:
			"Drafting and editing with the assistant, and reviewing what it proposes.",
		order: 60,
		collapsible: true,
	},
	{
		id: "chat-and-meetings",
		title: "Chat & meetings",
		purpose: "Talking to your team and putting time in the calendar.",
		order: 70,
		collapsible: true,
	},
	{
		id: "delivery-governance",
		title: "Delivery governance",
		purpose: "The four registers that turn conversations into records.",
		order: 80,
		collapsible: true,
	},
	{
		id: "teams-time-and-rates",
		title: "Teams, time & rates",
		purpose: "Reusable teams, billable time, rate cards and payouts.",
		order: 90,
		collapsible: true,
	},
	{
		id: "clients-and-marketplace",
		title: "Clients & the marketplace",
		purpose:
			"Finding work, selling services, contracts and invoices — on the web.",
		order: 100,
		collapsible: true,
	},
];

const UPDATED = "2026-09-23";

export const DOC_ARTICLES: DocArticle[] = [
	// ── 1. Start here ───────────────────────────────────────────────────────
	{
		slug: "what-is-proyekto",
		section: "start-here",
		order: 10,
		hub: true,
		title: "What is Proyekto",
		description:
			"An AI-assisted delivery platform: a roadmap, the team delivering it, and the governance around it, all in one project.",
		updated: UPDATED,
		related: ["core-concepts", "quickstart"],
	},
	{
		slug: "quickstart",
		section: "start-here",
		order: 20,
		popular: true,
		title: "Quickstart",
		description:
			"Go from signing up to a roadmap with real tasks and a teammate on it, in about ten minutes.",
		updated: UPDATED,
		keywords: ["get started", "setup", "first project", "onboarding"],
		related: ["creating-a-project", "overview", "access-and-roles"],
	},
	{
		slug: "core-concepts",
		section: "start-here",
		order: 30,
		title: "Core concepts",
		description:
			"The vocabulary — workspace, project, roadmap, epic, feature, task, team, access role — and how each contains the next.",
		updated: UPDATED,
		keywords: ["glossary", "terminology", "definitions"],
		related: ["roadmaps-overview", "access-and-roles", "plans"],
	},
	{
		slug: "navigating-proyekto",
		section: "start-here",
		order: 40,
		title: "Finding your way around",
		description:
			"A map of every surface: the dashboard, the workspace switcher, the in-project sidebar, and the pages behind the gear.",
		updated: UPDATED,
		keywords: ["navigation", "sidebar", "menu", "where is"],
		related: ["permissions", "limits-and-usage", "inside-a-project"],
	},

	// ── 2. Your account & apps ──────────────────────────────────────────────
	{
		slug: "your-account",
		section: "account-and-apps",
		order: 10,
		hub: true,
		title: "Your account",
		description:
			"Signing in, your profile, appearance, and the settings that follow you across every workspace.",
		updated: UPDATED,
		keywords: ["login", "sign in", "google", "password", "profile"],
		related: ["notifications", "members-and-seats"],
	},
	{
		slug: "notifications",
		section: "account-and-apps",
		order: 20,
		title: "Notifications",
		description:
			"Where Proyekto tells you something happened — the in-app list, push on mobile, and email — and how to tune each.",
		updated: UPDATED,
		keywords: ["email", "push", "alerts", "unsubscribe", "mentions"],
		related: ["mobile-app", "project-chat", "activity"],
	},
	{
		slug: "mobile-app",
		section: "account-and-apps",
		order: 30,
		title: "The Proyekto mobile app",
		description:
			"The iOS and Android apps run the same Proyekto you use on the web, with a few surfaces deliberately left out.",
		updated: UPDATED,
		keywords: ["ios", "android", "phone", "tablet", "offline"],
		related: ["notifications", "plans"],
	},
	{
		slug: "mcp-server",
		section: "account-and-apps",
		order: 40,
		plan: "pro",
		flagged: true,
		title: "Connect Proyekto to Claude (MCP)",
		description:
			"Proyekto ships a read-and-write MCP server so Claude and other MCP hosts can read your projects and, if you allow it, change them.",
		updated: UPDATED,
		keywords: ["claude", "api", "token", "oauth", "integration", "agent"],
		related: ["reviewing-changes", "permissions", "plans"],
	},

	// ── 3. Workspaces & plans ───────────────────────────────────────────────
	{
		slug: "workspaces",
		section: "workspaces-and-plans",
		order: 10,
		hub: true,
		title: "Workspaces",
		description:
			"A workspace is the top-level container that owns your projects and teams and carries the plan — and, deliberately, grants no access inside a project.",
		updated: UPDATED,
		keywords: ["organization", "org", "company", "slug"],
		related: ["members-and-seats", "plans", "limits-and-usage"],
	},
	{
		slug: "members-and-seats",
		section: "workspaces-and-plans",
		order: 20,
		title: "Members and seats",
		description:
			"Who is in your workspace, what a seat means for billing, and how invites, roles and provisioning work.",
		updated: UPDATED,
		keywords: ["invite", "seat", "billing", "saml", "scim", "sso"],
		related: ["access-and-roles", "teams", "limits-and-usage"],
	},
	{
		slug: "plans",
		section: "workspaces-and-plans",
		order: 30,
		title: "Plans",
		description:
			"What Free, Pro, Business and Enterprise each include, and how to tell which plan your workspace is on.",
		updated: UPDATED,
		keywords: ["pricing", "tier", "upgrade", "free", "pro", "business"],
		related: ["limits-and-usage", "workspaces"],
	},
	{
		slug: "limits-and-usage",
		section: "workspaces-and-plans",
		order: 40,
		title: "Limits and usage",
		description:
			"How plan limits behave — they block new work and never take anything away — and how to read the Usage page.",
		updated: UPDATED,
		keywords: ["quota", "cap", "over limit", "usage", "meter"],
		related: ["plans", "workspaces"],
	},

	// ── 4. Projects ─────────────────────────────────────────────────────────
	{
		slug: "creating-a-project",
		section: "projects",
		order: 10,
		hub: true,
		title: "Creating a project",
		description:
			"Three ways to start a project — blank, from a roadmap you already have, or from a brief — and what each sets up for you.",
		updated: UPDATED,
		keywords: ["new project", "brief", "convert roadmap"],
		related: ["inside-a-project", "access-and-roles", "limits-and-usage"],
	},
	{
		slug: "inside-a-project",
		section: "projects",
		order: 20,
		title: "Inside a project",
		description:
			"A tour of every page in a project — Overview, the three nav groups, Resources, and the settings behind the gear.",
		updated: UPDATED,
		keywords: ["overview", "resources", "files", "tabs", "settings"],
		related: ["navigating-proyekto", "permissions", "overview-governance"],
	},
	{
		slug: "access-and-roles",
		section: "projects",
		order: 30,
		popular: true,
		title: "Project access and roles",
		description:
			"Access to a project is granted person by person, on a ladder from viewer to owner — and it is entirely separate from workspace membership.",
		updated: UPDATED,
		keywords: ["permission", "share", "owner", "editor", "viewer", "invite"],
		related: ["permissions", "members-and-seats", "teams", "sharing-a-roadmap"],
	},
	{
		slug: "permissions",
		section: "projects",
		order: 40,
		title: "Fine-tuning permissions",
		description:
			"On top of a role, each person can have individual permissions switched on or off, page by page and action by action.",
		updated: UPDATED,
		keywords: ["capability", "restrict", "hide page", "sensitive"],
		related: ["access-and-roles", "members-and-seats", "teams"],
	},

	// ── 5. Roadmaps & work ──────────────────────────────────────────────────
	{
		slug: "roadmaps-overview",
		section: "roadmaps-and-work",
		order: 10,
		hub: true,
		popular: true,
		title: "How roadmaps work",
		description:
			"One dataset — epics, features and tasks — shown four ways: the roadmap tree, the epic view, the timeline, and the board.",
		updated: UPDATED,
		keywords: ["epic", "feature", "task", "hierarchy", "canvas"],
		related: [
			"tasks",
			"board",
			"timeline-and-milestones",
			"change-history",
			"limits-and-usage",
		],
	},
	{
		slug: "building-a-roadmap",
		section: "roadmaps-and-work",
		order: 20,
		title: "Building a roadmap",
		description:
			"Creating and shaping epics, features and tasks on the roadmap canvas — by hand, from a template, or with the assistant.",
		updated: UPDATED,
		keywords: ["canvas", "drag", "nest", "reorder", "draft"],
		related: ["change-history", "templates", "reviewing-changes"],
	},
	{
		slug: "tasks",
		section: "roadmaps-and-work",
		order: 30,
		title: "Tasks",
		description:
			"Everything a task holds — status, assignees, checklists, comments, attachments and dependencies — and how it rolls up to its feature.",
		updated: UPDATED,
		keywords: ["todo", "assignee", "checklist", "blocked", "dependency"],
		related: ["board", "overview-governance", "knowledge-base"],
	},
	{
		slug: "board",
		section: "roadmaps-and-work",
		order: 40,
		title: "The board",
		description:
			"The project's kanban — every task on one roadmap, grouped by status, with drag-and-drop between columns.",
		updated: UPDATED,
		keywords: ["kanban", "swimlane", "column", "drag"],
		related: ["tasks", "command-center"],
	},
	{
		slug: "command-center",
		section: "roadmaps-and-work",
		order: 50,
		title: "Command center",
		description:
			"Every task assigned to you, across every project you have access to, in one list.",
		updated: UPDATED,
		keywords: ["my tasks", "assigned", "cross-project", "todo list"],
		related: ["board", "notifications"],
	},
	{
		slug: "timeline-and-milestones",
		section: "roadmaps-and-work",
		order: 60,
		title: "Timeline and milestones",
		description:
			"The Gantt-style view of features over time, and the milestones that group them into dates you can report against.",
		updated: UPDATED,
		keywords: ["gantt", "schedule", "dates", "deadline", "slippage"],
		related: ["roadmaps-overview", "building-a-roadmap"],
	},
	{
		slug: "templates",
		section: "roadmaps-and-work",
		order: 70,
		title: "Roadmap templates",
		description:
			"Start from a published template instead of a blank canvas — browse the gallery, filter by category, and apply a version.",
		updated: UPDATED,
		keywords: ["gallery", "starter", "preset", "publish"],
		related: ["building-a-roadmap", "selling"],
	},
	{
		slug: "change-history",
		section: "roadmaps-and-work",
		order: 80,
		title: "Change history and rollback",
		description:
			"Every structural change to a roadmap is recorded as a commit you can inspect, discard before it lands, or roll back after.",
		updated: UPDATED,
		keywords: ["undo", "revert", "commit", "diff", "audit"],
		related: ["reviewing-changes", "activity"],
	},
	{
		slug: "sharing-a-roadmap",
		section: "roadmaps-and-work",
		order: 90,
		title: "Sharing a roadmap",
		description:
			"Send a roadmap to someone without an account using a link that grants viewing or commenting — never editing.",
		updated: UPDATED,
		keywords: ["share link", "public", "external", "client", "read-only"],
		related: ["access-and-roles"],
	},

	// ── 6. AI assistant ─────────────────────────────────────────────────────
	{
		slug: "overview",
		section: "ai-assistant",
		order: 10,
		hub: true,
		popular: true,
		title: "The AI assistant",
		description:
			"Proyekto's assistant drafts and edits roadmaps, answers questions about your work, and never changes structure without showing you the diff first.",
		updated: UPDATED,
		keywords: ["ai", "assistant", "chat", "generate", "draft", "agent"],
		related: [
			"reviewing-changes",
			"context-and-mentions",
			"knowledge-base",
			"plans",
		],
	},
	{
		slug: "reviewing-changes",
		section: "ai-assistant",
		order: 20,
		title: "Reviewing and committing AI changes",
		description:
			"Structural edits from the assistant are two-stage: you read the semantic diff first, then commit — and you can revert afterwards.",
		updated: UPDATED,
		keywords: ["preview", "diff", "commit", "approve", "undo"],
		related: ["change-history", "mcp-server"],
	},
	{
		slug: "context-and-mentions",
		section: "ai-assistant",
		order: 30,
		title: "Giving the assistant context",
		description:
			"Point the assistant at exactly the right thing with @-references to projects, roadmaps, work items and people.",
		updated: UPDATED,
		keywords: ["mention", "reference", "scope", "@"],
		related: ["overview", "knowledge-base"],
	},
	{
		slug: "knowledge-base",
		section: "ai-assistant",
		order: 40,
		flagged: true,
		title: "The project knowledge base",
		description:
			"An optional per-project index of your chat, comments, activity and briefs that lets the assistant answer from what your team actually said.",
		updated: UPDATED,
		keywords: ["rag", "retrieval", "search", "context", "memory"],
		related: ["overview", "context-and-mentions", "decisions"],
	},

	// ── 7. Chat & meetings ──────────────────────────────────────────────────
	{
		slug: "project-chat",
		section: "chat-and-meetings",
		order: 10,
		hub: true,
		title: "Project chat",
		description:
			"Slack-style channels inside a project — system rooms like #general, ad-hoc channels you create, and everything a message can do.",
		updated: UPDATED,
		keywords: ["channel", "message", "reaction", "thread", "mention"],
		related: ["direct-messages-and-inbox", "notifications", "permissions"],
	},
	{
		slug: "direct-messages-and-inbox",
		section: "chat-and-meetings",
		order: 20,
		title: "Direct messages and the Inbox",
		description:
			"One-to-one conversations inside a project, and the Inbox that gathers your DMs and mentions from everywhere.",
		updated: UPDATED,
		keywords: ["dm", "private message", "inbox", "unread"],
		related: ["project-chat", "notifications"],
	},
	{
		slug: "meetings",
		section: "chat-and-meetings",
		order: 30,
		title: "Meetings",
		description:
			"A full calendar inside Proyekto — day, week, month and year views, click a slot to create, and a scheduler that handles timezones, video links and guests.",
		updated: UPDATED,
		keywords: ["calendar", "schedule", "call", "jitsi", "zoom", "timezone"],
		related: ["recurring-meetings", "google-calendar", "notifications"],
	},
	{
		slug: "recurring-meetings",
		section: "chat-and-meetings",
		order: 40,
		title: "Recurring meetings",
		description:
			"Build a repeat rule, then change one occurrence, this and everything after it, or the whole series.",
		updated: UPDATED,
		keywords: ["repeat", "series", "weekly", "rrule", "occurrence"],
		related: ["meetings"],
	},
	{
		slug: "google-calendar",
		section: "chat-and-meetings",
		order: 50,
		flagged: true,
		title: "Google Calendar and Meet",
		description:
			"An optional integration that mirrors Proyekto meetings into Google Calendar and creates Meet links for you.",
		updated: UPDATED,
		keywords: ["google", "meet", "sync", "integration"],
		related: ["meetings", "recurring-meetings"],
	},

	// ── 8. Delivery governance ──────────────────────────────────────────────
	{
		slug: "overview-governance",
		section: "delivery-governance",
		order: 10,
		hub: true,
		plan: "pro",
		title: "Delivery governance",
		description:
			"Four registers — deliverables, change requests, risks and issues, and decisions — that turn conversations into records with owners and outcomes.",
		updated: UPDATED,
		keywords: ["register", "governance", "process", "audit"],
		related: [
			"deliverables",
			"change-requests",
			"risks-and-issues",
			"decisions",
			"activity",
			"plans",
		],
	},
	{
		slug: "deliverables",
		section: "delivery-governance",
		order: 20,
		plan: "pro",
		title: "Deliverables",
		description:
			"Define what you are handing over, with acceptance criteria and named reviewers, then run it through submit and review.",
		updated: UPDATED,
		keywords: ["handover", "acceptance", "review", "sign off"],
		related: ["overview-governance", "activity", "tasks"],
	},
	{
		slug: "change-requests",
		section: "delivery-governance",
		order: 30,
		plan: "pro",
		title: "Change requests",
		description:
			"Propose a change to agreed scope, get a decision on it, and record when it was actually applied.",
		updated: UPDATED,
		keywords: ["scope", "variation", "approve", "reject"],
		related: ["overview-governance", "activity", "tasks"],
	},
	{
		slug: "risks-and-issues",
		section: "delivery-governance",
		order: 40,
		plan: "pro",
		title: "Risks and issues",
		description:
			"One register for what might go wrong and what already has, with an explicit split between what your team sees and what the client sees.",
		updated: UPDATED,
		keywords: ["risk", "issue", "mitigation", "internal", "external"],
		related: ["overview-governance", "activity", "tasks"],
	},
	{
		slug: "decisions",
		section: "delivery-governance",
		order: 50,
		plan: "pro",
		title: "Decisions",
		description:
			"Write down what you chose, which options you considered, and mark it final so nobody relitigates it in chat.",
		updated: UPDATED,
		keywords: ["decision log", "adr", "rationale", "final"],
		related: ["overview-governance", "activity", "tasks"],
	},
	{
		slug: "activity",
		section: "delivery-governance",
		order: 60,
		title: "Activity",
		description:
			"The per-project audit trail of who did what and when, with a retention window set by your plan.",
		updated: UPDATED,
		keywords: ["log", "audit", "history", "retention", "export"],
		related: ["overview-governance", "change-history", "limits-and-usage"],
	},

	// ── 9. Teams, time & rates ──────────────────────────────────────────────
	{
		slug: "teams",
		section: "teams-time-and-rates",
		order: 10,
		hub: true,
		title: "Teams",
		description:
			"A team is a reusable group of people you attach to projects — and curating its members is the fastest way to grant project access.",
		updated: UPDATED,
		keywords: ["group", "squad", "attach", "invite"],
		related: ["access-and-roles", "time-tracking", "limits-and-usage"],
	},
	{
		slug: "time-tracking",
		section: "teams-time-and-rates",
		order: 20,
		plan: "pro",
		title: "Time tracking",
		description:
			"Log time against a project, send it for approval, and see what is billable — across My logs and Team logs.",
		updated: UPDATED,
		keywords: ["timesheet", "hours", "log", "approve", "billable"],
		related: ["rates-and-currency", "payouts", "teams", "plans"],
	},
	{
		slug: "rates-and-currency",
		section: "teams-time-and-rates",
		order: 30,
		plan: "pro",
		title: "Rates and currency",
		description:
			"Set a team's default currency and per-member and per-project rate cards so approved time resolves to real amounts.",
		updated: UPDATED,
		keywords: ["rate card", "hourly", "currency", "billing"],
		related: ["time-tracking", "payouts", "plans"],
	},
	{
		slug: "payouts",
		section: "teams-time-and-rates",
		order: 40,
		plan: "pro",
		title: "Payouts",
		description:
			"Group approved time logs of a single currency into a payout so what is owed is recorded in one place.",
		updated: UPDATED,
		keywords: ["pay", "owed", "settlement", "invoice"],
		related: [
			"time-tracking",
			"rates-and-currency",
			"contracts-and-invoices",
			"plans",
		],
	},

	// ── 10. Clients & the marketplace (web only) ────────────────────────────
	{
		slug: "marketplace",
		section: "clients-and-marketplace",
		order: 10,
		hub: true,
		surface: "web",
		title: "The marketplace",
		description:
			"Browse consultants by category, read their profiles, and post a brief to get a project started.",
		updated: UPDATED,
		keywords: ["hire", "consultant", "brief", "category", "directory"],
		related: ["creating-a-project", "selling", "mobile-app"],
	},
	{
		slug: "selling",
		section: "clients-and-marketplace",
		order: 20,
		surface: "web",
		title: "Selling on Proyekto",
		description:
			"How to become a verified consultant or discoverable talent, and what each status unlocks.",
		updated: UPDATED,
		keywords: ["apply", "verified", "talent", "go live", "services"],
		related: ["marketplace", "templates", "mobile-app"],
	},
	{
		slug: "contracts-and-invoices",
		section: "clients-and-marketplace",
		order: 30,
		surface: "web",
		title: "Contracts and invoices",
		description:
			"Agree terms with a contract that can be signed in-app or by link, then record what was invoiced and what was paid.",
		updated: UPDATED,
		keywords: ["contract", "sign", "invoice", "paid", "overdue"],
		related: ["payouts", "marketplace", "mobile-app"],
	},
];

/** `/docs/<section>/<slug>` — the article's public path. */
export function docHref(article: Pick<DocArticle, "section" | "slug">): string {
	return `/docs/${article.section}/${article.slug}`;
}

/** The glob key for an article's markdown body. */
export function docFileKey(
	article: Pick<DocArticle, "section" | "slug">,
): string {
	return `/src/content/docs/${article.section}/${article.slug}.md`;
}

export function findArticle(
	section: string,
	slug: string,
): DocArticle | undefined {
	return DOC_ARTICLES.find(
		(article) => article.section === section && article.slug === slug,
	);
}

export function sectionArticles(section: DocSectionId): DocArticle[] {
	return DOC_ARTICLES.filter((a) => a.section === section).sort(
		(a, b) => a.order - b.order,
	);
}

export function sectionsInOrder(): DocSection[] {
	return [...DOC_SECTIONS].sort((a, b) => a.order - b.order);
}

export function popularArticles(): DocArticle[] {
	return DOC_ARTICLES.filter((a) => a.popular);
}
