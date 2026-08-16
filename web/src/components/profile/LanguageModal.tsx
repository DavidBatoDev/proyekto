import { Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type {
	FluencyLevel,
	LanguageMeta,
	UserLanguage,
} from "@/services/profile.service";
import { ProfileModal } from "./ProfileModal";

type LangPayload = Omit<UserLanguage, "id" | "user_id" | "created_at">;

interface Props {
	isOpen: boolean;
	onClose: () => void;
	onSave: (payload: LangPayload) => void;
	isSaving?: boolean;
	initialData?: typeof empty | null;
	languagesMeta: LanguageMeta[];
}

const empty: LangPayload = {
	language_id: "",
	fluency_level: "conversational" as FluencyLevel,
	language: { id: "", name: "", code: "" },
};

const FLUENCY_LEVELS = [
	{ value: "basic", label: "Basic" },
	{ value: "conversational", label: "Conversational" },
	{ value: "fluent", label: "Fluent" },
	{ value: "native", label: "Native or Bilingual" },
];

export function LanguageModal({
	isOpen,
	onClose,
	onSave,
	isSaving,
	initialData,
	languagesMeta,
}: Props) {
	const [form, setForm] = useState<LangPayload>(empty);
	const [search, setSearch] = useState("");

	const isEdit = !!initialData?.language_id;

	useEffect(() => {
		if (isOpen) {
			setForm(initialData || empty);
			setSearch("");
		}
	}, [isOpen, initialData]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!form.language_id || !form.fluency_level) return;
		onSave(form);
	};

	const filteredLangs = languagesMeta.filter((l) =>
		l.name.toLowerCase().includes(search.toLowerCase()),
	);

	return (
		<ProfileModal
			isOpen={isOpen}
			onClose={onClose}
			title={isEdit ? "Edit language" : "Add language"}
			width="md"
		>
			<form onSubmit={handleSubmit} className="space-y-6">
				{/*
          Fix: add `overflow-visible` to the grid so the dropdown isn't clipped,
          and use `z-50` on the dropdown itself to ensure it renders above siblings.
        */}
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 overflow-visible">
					{/* Language field */}
					<div className="space-y-1.5">
						<label className="text-sm font-semibold text-gray-900">
							Language
						</label>
						{!isEdit ? (
							<div className="relative">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
								<input
									type="text"
									placeholder="Search language..."
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#ff9933] focus:border-transparent outline-none"
								/>
								{search && (
									<div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
										{filteredLangs.length > 0 ? (
											filteredLangs.map((lang) => (
												<button
													key={lang.id}
													type="button"
													onClick={() => {
														setForm({
															...form,
															language_id: lang.id,
															language: lang,
														});
														setSearch(lang.name);
													}}
													className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 text-gray-700"
												>
													{lang.name}
												</button>
											))
										) : (
											<div className="p-3 text-sm text-gray-500 text-center">
												No languages found
											</div>
										)}
									</div>
								)}
							</div>
						) : (
							<input
								type="text"
								disabled
								value={form.language?.name || ""}
								className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
							/>
						)}
					</div>

					{/* Proficiency field */}
					<div className="space-y-1.5">
						<label className="text-sm font-semibold text-gray-900">
							Proficiency level
						</label>
						<select
							value={form.fluency_level}
							onChange={(e) =>
								setForm({
									...form,
									fluency_level: e.target.value as FluencyLevel,
								})
							}
							className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#ff9933] focus:border-transparent outline-none bg-white"
						>
							<option value="" disabled>
								Select proficiency level
							</option>
							{FLUENCY_LEVELS.map((lvl) => (
								<option key={lvl.value} value={lvl.value}>
									{lvl.label}
								</option>
							))}
						</select>
					</div>
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
						disabled={
							isSaving ||
							!form.language_id ||
							!form.fluency_level ||
							(search !== "" && search !== form.language.name && !isEdit)
						}
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
