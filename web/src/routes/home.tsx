import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "./index";

/**
 * The marketing page, reachable whether or not you are signed in. `/` shows
 * the same page to anonymous visitors but forwards signed-in users to their
 * dashboard, so this is where the in-app brand mark points.
 */
export const Route = createFileRoute("/home")({
	component: LandingPage,
});
