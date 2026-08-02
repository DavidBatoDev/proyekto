import { AppSectionHeader } from "@/components/common/AppPrimitives";
import { PermissionCatalogContent } from "./PermissionCatalogContent";

export function PermissionCatalogPage() {
	return (
		<div className="space-y-5">
			<AppSectionHeader
				kicker="Team"
				title="Permissions catalog"
				subtitle="Reference only — nothing here changes anyone's access."
			/>
			<PermissionCatalogContent />
		</div>
	);
}
