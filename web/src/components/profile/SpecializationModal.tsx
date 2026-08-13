import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type {
	SpecializationCategory,
	UserSpecialization,
} from "@/services/profile.service";
import { ProfileModal } from "./ProfileModal";

type SpecializationPayload = Omit<
	UserSpecialization,
	"id" | "user_id" | "created_at" | "updated_at"
>;

interface Props {
	isOpen: boolean;
	onClose: () => void;
	onSave: (payload: SpecializationPayload) => void;
	isSaving?: boolean;
	initialData?: SpecializationPayload;
}

const empty: SpecializationPayload = {
	category: "other",
	sub_category: "",
	years_of_experience: undefined,
	description: "",
};

const CATEGORIES: { value: SpecializationCategory; label: string }[] = [
	{ value: "fintech", label: "Financial Technology (FinTech)" },
	{ value: "healthcare", label: "Healthcare & MedTech" },
	{ value: "e_commerce", label: "E-Commerce & Retail" },
	{ value: "saas", label: "Software as a Service (SaaS)" },
	{ value: "education", label: "EdTech & Education" },
	{ value: "real_estate", label: "PropTech & Real Estate" },
	{ value: "legal", label: "LegalTech & Law" },
	{ value: "marketing", label: "Marketing & AdTech" },
	{ value: "logistics", label: "Logistics & Supply Chain" },
	{ value: "media", label: "Media & Entertainment" },
	{ value: "gaming", label: "Gaming & Esports" },
	{ value: "ai_ml", label: "Artificial Intelligence & Machine Learning" },
	{ value: "cybersecurity", label: "Cybersecurity" },
	{ value: "blockchain", label: "Blockchain & Web3" },
	{ value: "other", label: "Other / General" },
];

export function SpecializationModal({
	isOpen,
	onClose,
	onSave,
	isSaving,
	initialData,
}: Props) {
	const [form, setForm] = useState<SpecializationPayload>(empty);

	const isEdit = !!initialData?.category;

	useEffect(() => {
		if (isOpen) {
			setForm(initialData || empty);
		}
	}, [isOpen, initialData]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!form.category) return;

		// Convert string inputs back to numbers where appropriate
		const payload = {
			...form,
			years_of_experience: form.years_of_experience
				? Number(form.years_of_experience)
				: null,
			sub_category: form.sub_category || null,
			description: form.description || null,
		};
		onSave(payload);
	};

	return (
		<ProfileModal
			isOpen={isOpen}
			onClose={onClose}
			title={isEdit ? "Edit specialization" : "Add specialization"}
			width="md"
		>
			<form onSubmit={handleSubmit} className="space-y-4">
				<div className="space-y-1.5">
					<label className="text-sm font-semibold text-gray-900">
						Industry Category *
					</label>
					<select
						required
						value={form.category}
						onChange={(e) =>
							setForm({
								...form,
								category: e.target.value as SpecializationCategory,
							})
						}
						className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#ff9933] focus:border-transparent outline-none bg-white"
					>
						{CATEGORIES.map((c) => (
							<option key={c.value} value={c.value}>
								{c.label}
							</option>
						))}
					</select>
				</div>

				<div className="space-y-1.5">
					<label className="text-sm font-semibold text-gray-900">
						Sub-category (Optional)
					</label>
					<input
						type="text"
						placeholder="e.g. Payment Gateways, DeFi, Compliance"
						value={form.sub_category || ""}
						onChange={(e) => setForm({ ...form, sub_category: e.target.value })}
						className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#ff9933] focus:border-transparent outline-none"
					/>
				</div>

				<div className="space-y-1.5">
					<label className="text-sm font-semibold text-gray-900">
						Years of Experience
					</label>
					<input
						type="number"
						min="0"
						max="100"
						placeholder="e.g. 5"
						value={form.years_of_experience || ""}
						onChange={(e) =>
							setForm({
								...form,
								years_of_experience: e.target.value
									? Number(e.target.value)
									: undefined,
							})
						}
						className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#ff9933] focus:border-transparent outline-none"
					/>
				</div>

				<div className="space-y-1.5">
					<label className="text-sm font-semibold text-gray-900">
						Description (Optional)
					</label>
					<textarea
						placeholder="Briefly describe your expertise or notable achievements in this area..."
						value={form.description || ""}
						onChange={(e) => setForm({ ...form, description: e.target.value })}
						rows={3}
						className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#ff9933] focus:border-transparent outline-none resize-none"
					/>
				</div>

				<div className="pt-4 flex justify-end gap-3 border-t border-gray-100">
					<button
						type="button"
						onClick={onClose}
						disabled={isSaving}
						className="px-5 py-2 text-sm font-medium text-[#14b8a6] hover:bg-teal-50 rounded-full transition-colors"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={isSaving || !form.category}
						className="flex items-center gap-2 px-5 py-2 bg-gray-100 text-gray-400 text-sm font-medium rounded-full hover:bg-[#ff9933] hover:text-white disabled:opacity-50 disabled:hover:bg-gray-100 disabled:hover:text-gray-400 transition-colors"
					>
						{isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
						Save
					</button>
				</div>
			</form>
		</ProfileModal>
	);
}
