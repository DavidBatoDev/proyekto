import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
	ProjectContract,
	type StepKey,
} from "@/components/finance/ProjectContract";
import { MarketplaceShell } from "@/components/layout/MarketplaceShell";
import { useAuthStore } from "@/stores/authStore";

const CONTRACT_SECTIONS: StepKey[] = [
	"parties",
	"terms",
	"services",
	"agreement",
	"signatures",
];

export const Route = createFileRoute("/_marketplace/finance/$contractId")({
	beforeLoad: () => {
		if (!useAuthStore.getState().isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	validateSearch: (search: Record<string, unknown>) => ({
		section:
			typeof search.section === "string" &&
			CONTRACT_SECTIONS.includes(search.section as StepKey)
				? (search.section as StepKey)
				: undefined,
	}),
	component: ContractEditorPage,
});

function ContractEditorPage() {
	const { contractId } = Route.useParams();
	const { section } = Route.useSearch();
	const navigate = useNavigate();

	return (
		<MarketplaceShell>
			<ProjectContract
				contractId={contractId}
				initialStep={section}
				onBack={() =>
					void navigate({ to: "/finance", search: { tab: "contracts" } })
				}
				onOpenContract={(nextContractId) =>
					void navigate({
						to: "/finance/$contractId",
						params: { contractId: nextContractId },
						search: { section: "terms" },
						replace: true,
					})
				}
			/>
		</MarketplaceShell>
	);
}
