/**
 * The dashboard tour (`dashboard_v1`).
 *
 * Targets are `data-tour` attributes, never class names: the Tailwind classes
 * on these cards churn constantly and a stale selector makes Joyride stall on a
 * step with no visible cause.
 */

import type { Step } from "react-joyride";
import { DASHBOARD_DEMO_DATASET } from "./demo/dashboardDemoDataset";
import type { TourDefinition } from "./types";

export const DASHBOARD_TOUR_KEY = "dashboard_v1";

const welcomeStep: Step = {
	target: '[data-tour="dashboard-welcome"]',
	title: "Your portfolio at a glance",
	content:
		"This is your Proyekto home. The counters track the work you own across every project, so you can see where things stand without opening anything.",
	placement: "bottom",
	skipBeacon: true,
};

const createStep: Step = {
	target: '[data-tour="dashboard-create"]',
	title: "Start something new",
	content:
		"Create a project when you're ready to fund and deliver work, or start from a roadmap to plan it out first — the AI assistant can draft the whole plan with you.",
	placement: "bottom",
};

const teamsStep: Step = {
	target: '[data-tour="dashboard-teams"]',
	title: "Your teams",
	content:
		"Everyone gets a workspace of their own. Create more teams to group the people you deliver with, and pending invitations show up here first.",
	placement: "top",
};

const projectsStep: Step = {
	target: '[data-tour="dashboard-projects"]',
	title: "Projects are where work gets delivered",
	content:
		"A project holds the brief, the contract, the people, and the delivery. Open one to see its roadmap, tasks, chat, and invoices in a single place.",
	placement: "top",
};

const roadmapsStep: Step = {
	target: '[data-tour="dashboard-roadmaps"]',
	title: "Roadmaps plan the work",
	content:
		"Break work into epics, features, and tasks on the canvas — or describe what you want and let the AI assistant build and edit the roadmap for you. Any roadmap can become a project.",
	placement: "top",
};

const navStep: Step = {
	target: '[data-tour="sidebar-nav"]',
	title: "Everything else lives here",
	content:
		"Inbox collects what needs your attention, Command Center is every task assigned to you across projects, and Meetings holds your calls. That's the tour — you can replay it any time from your profile menu.",
	placement: "right",
};

export const DASHBOARD_TOUR: TourDefinition = {
	key: DASHBOARD_TOUR_KEY,
	scopeType: "global",
	steps: [
		welcomeStep,
		createStep,
		teamsStep,
		projectsStep,
		roadmapsStep,
		navStep,
	],
	// The sidebar collapses out of the DOM below the mobile breakpoint, so the
	// nav step is dropped rather than left to target a node that isn't there.
	mobileSteps: [
		welcomeStep,
		createStep,
		teamsStep,
		projectsStep,
		{
			...roadmapsStep,
			content:
				"Break work into epics, features, and tasks — or let the AI assistant draft the roadmap for you. That's the tour; replay it any time from your profile menu.",
		},
	],
	demoDataset: DASHBOARD_DEMO_DATASET,
};
