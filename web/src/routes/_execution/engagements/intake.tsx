import { createFileRoute } from "@tanstack/react-router";
import { IntakePage } from "@/components/intake/IntakePage";

/**
 * Engagements -> Import documents (document intake). `?batch=` opens one
 * import; without it, the list of the caller's imports.
 */
export const Route = createFileRoute("/_execution/engagements/intake")({
	validateSearch: (search: Record<string, unknown>): { batch?: string } =>
		typeof search.batch === "string" && search.batch
			? { batch: search.batch }
			: {},
	component: IntakeRoute,
});

function IntakeRoute() {
	const { batch } = Route.useSearch();
	return <IntakePage batchId={batch} />;
}
