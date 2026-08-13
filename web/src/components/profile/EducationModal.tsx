import { GraduationCap, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { UserEducation } from "@/services/profile.service";
import { ProfileModal } from "./ProfileModal";

type EduPayload = Omit<
	UserEducation,
	"id" | "user_id" | "created_at" | "updated_at"
>;

interface Props {
	isOpen: boolean;
	onClose: () => void;
	onSave: (payload: EduPayload) => void;
	isSaving?: boolean;
	initialData?: Partial<UserEducation>;
}

const empty: EduPayload = {
	institution: "",
	degree: "",
	field_of_study: "",
	start_year: null,
	end_year: null,
	is_current: false,
	description: "",
};

export function EducationModal({
	isOpen,
	onClose,
	onSave,
	isSaving,
	initialData,
}: Props) {
	const isEdit = !!initialData;
	const [form, setForm] = useState<EduPayload>(empty);
	const set = (k: keyof EduPayload, v: unknown) =>
		setForm((p) => ({ ...p, [k]: v }));

	useEffect(() => {
		if (isOpen) {
			setForm(
				initialData
					? {
							institution: initialData.institution ?? "",
							degree: initialData.degree ?? "",
							field_of_study: initialData.field_of_study ?? "",
							start_year: initialData.start_year ?? null,
							end_year: initialData.end_year ?? null,
							is_current: initialData.is_current ?? false,
							description: initialData.description ?? "",
						}
					: empty,
			);
		}
	}, [isOpen, initialData]);

	const handleClose = () => {
		setForm(empty);
		onClose();
	};
	const handleSave = () => {
		if (!form.institution.trim()) return;
		onSave(form);
	};

	const cls =
		"w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff9933]/50";

	return (
		<ProfileModal
			isOpen={isOpen}
			onClose={handleClose}
			title={isEdit ? "Edit Education" : "Add Education"}
		>
			<div className="space-y-4">
				<div>
					<label className="block text-xs font-medium text-gray-600 mb-1">
						Institution <span className="text-red-400">*</span>
					</label>
					<input
						value={form.institution}
						onChange={(e) => set("institution", e.target.value)}
						className={cls}
						placeholder="e.g. University of the Philippines"
					/>
				</div>

				<div className="grid grid-cols-2 gap-3">
					<div>
						<label className="block text-xs font-medium text-gray-600 mb-1">
							Degree
						</label>
						<input
							value={form.degree ?? ""}
							onChange={(e) => set("degree", e.target.value)}
							className={cls}
							placeholder="e.g. Bachelor of Science"
						/>
					</div>
					<div>
						<label className="block text-xs font-medium text-gray-600 mb-1">
							Field of Study
						</label>
						<input
							value={form.field_of_study ?? ""}
							onChange={(e) => set("field_of_study", e.target.value)}
							className={cls}
							placeholder="e.g. Computer Science"
						/>
					</div>
				</div>

				<div className="grid grid-cols-2 gap-3">
					<div>
						<label className="block text-xs font-medium text-gray-600 mb-1">
							Start Year
						</label>
						<input
							type="number"
							value={form.start_year ?? ""}
							onChange={(e) =>
								set("start_year", Number(e.target.value) || null)
							}
							className={cls}
							placeholder="2018"
							min={1950}
							max={new Date().getFullYear()}
						/>
					</div>
					<div>
						<label className="block text-xs font-medium text-gray-600 mb-1">
							{form.is_current ? "Expected Graduation" : "End Year"}
						</label>
						<input
							type="number"
							value={form.end_year ?? ""}
							onChange={(e) => set("end_year", Number(e.target.value) || null)}
							disabled={form.is_current}
							className={`${cls} disabled:opacity-50`}
							placeholder="2022"
						/>
					</div>
				</div>

				<label className="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						checked={form.is_current}
						onChange={(e) => set("is_current", e.target.checked)}
						className="w-4 h-4 accent-[#ff9933]"
					/>
					<span className="text-sm text-gray-700">
						I am currently studying here
					</span>
				</label>

				<div>
					<label className="block text-xs font-medium text-gray-600 mb-1">
						Description
					</label>
					<textarea
						value={form.description ?? ""}
						onChange={(e) => set("description", e.target.value)}
						rows={3}
						className={`${cls} resize-y`}
						placeholder="Activities, honors, relevant coursework..."
					/>
				</div>

				<div className="flex justify-end gap-3 pt-2">
					<button
						onClick={handleClose}
						className="px-5 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
					>
						Cancel
					</button>
					<button
						onClick={handleSave}
						disabled={isSaving || !form.institution.trim()}
						className="px-5 py-2 text-sm bg-[#ff9933] text-white rounded-lg hover:bg-[#e68829] disabled:opacity-60 transition-colors flex items-center gap-2"
					>
						{isSaving ? (
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
						) : (
							<GraduationCap className="w-3.5 h-3.5" />
						)}
						{isSaving ? "Saving…" : isEdit ? "Save Changes" : "Add Education"}
					</button>
				</div>
			</div>
		</ProfileModal>
	);
}
