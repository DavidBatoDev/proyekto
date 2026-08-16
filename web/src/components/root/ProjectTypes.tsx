import type { LucideIcon } from "lucide-react";
import {
	BarChart3,
	FileText,
	Globe,
	Palette,
	Presentation,
	ShoppingCart,
	Smartphone,
	Target,
} from "lucide-react";

interface ProjectType {
	icon: LucideIcon;
	label: string;
	description: string;
}

const projectTypes: ProjectType[] = [
	{
		icon: Globe,
		label: "Web Application",
		description: "Full-stack platforms",
	},
	{ icon: Smartphone, label: "Mobile App", description: "iOS & Android apps" },
	{ icon: ShoppingCart, label: "E-commerce", description: "Online stores" },
	{ icon: BarChart3, label: "SaaS Product", description: "Cloud software" },
	{ icon: Target, label: "Landing Page", description: "Marketing sites" },
	{ icon: Palette, label: "Design System", description: "UI libraries" },
	{ icon: FileText, label: "API Service", description: "Backend systems" },
	{
		icon: Presentation,
		label: "Enterprise App",
		description: "Business tools",
	},
];

export const ProjectTypes = () => {
	return (
		<div className="mb-20">
			<div className="flex flex-wrap items-center justify-center gap-3">
				{projectTypes.map((type) => {
					const IconComponent = type.icon;
					return (
						<button
							key={type.label}
							className="flex items-center gap-2 px-5 py-3 bg-white border-2 border-gray-200 rounded-xl hover:border-primary hover:shadow-md transition-all group"
						>
							<IconComponent className="w-6 h-6 text-primary group-hover:scale-110 transition-transform" />
							<div className="text-left">
								<div className="font-semibold text-gray-900 text-sm">
									{type.label}
								</div>
								<div className="text-xs text-gray-500">{type.description}</div>
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
};
