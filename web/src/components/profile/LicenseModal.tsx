import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { LicenseType, UserLicense } from "@/services/profile.service";
import { ProfileModal } from "./ProfileModal";

type LicensePayload = Omit<
	UserLicense,
	"id" | "user_id" | "created_at" | "updated_at"
>;

interface Props {
	isOpen: boolean;
	onClose: () => void;
	onSave: (payload: LicensePayload) => void;
	isSaving?: boolean;
	initialData?: LicensePayload;
}

const empty: LicensePayload = {
	name: "",
	type: "other",
	issuing_authority: "",
	license_number: "",
	issue_date: "",
	expiry_date: "",
	is_active: true,
};

const LICENSE_TYPES: { value: LicenseType; label: string }[] = [
	{ value: "legal", label: "Legal" },
	{ value: "engineering", label: "Engineering" },
	{ value: "medical", label: "Medical" },
	{ value: "financial", label: "Financial" },
	{ value: "real_estate", label: "Real Estate" },
	{ value: "other", label: "Other" },
];

export function LicenseModal({
	isOpen,
	onClose,
	onSave,
	isSaving,
	initialData,
}: Props) {
	const [form, setForm] = useState<LicensePayload>(empty);

	const isEdit = !!initialData?.name;

	useEffect(() => {
		if (isOpen) {
			setForm(initialData || empty);
		}
	}, [isOpen, initialData]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!form.name || !form.issuing_authority) return;

		// Ensure empty strings for dates are sent as null or omitted if the backend expects it.
		// Our DB allows nulls, so treating empty string as null is safer.
		const payload = {
			...form,
			issue_date: form.issue_date || null,
			expiry_date: form.expiry_date || null,
			license_number: form.license_number || null,
		};
		onSave(payload);
	};

	return (
		<ProfileModal
			isOpen={isOpen}
			onClose={onClose}
			title={isEdit ? "Edit license" : "Add license"}
			width="md"
		>
			<form onSubmit={handleSubmit} className="space-y-5">
				<div className="space-y-1.5">
					<label className="text-sm font-semibold text-foreground">
						License name *
					</label>
					<input
						required
						autoFocus
						type="text"
						placeholder="e.g. Certified Public Accountant"
						value={form.name}
						onChange={(e) => setForm({ ...form, name: e.target.value })}
						className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
					/>
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div className="space-y-1.5">
						<label className="text-sm font-semibold text-foreground">
							Issuing authority *
						</label>
						<input
							required
							type="text"
							placeholder="e.g. State Board of Accountancy"
							value={form.issuing_authority}
							onChange={(e) =>
								setForm({ ...form, issuing_authority: e.target.value })
							}
							className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
						/>
					</div>
					<div className="space-y-1.5">
						<label className="text-sm font-semibold text-foreground">
							License type
						</label>
						<select
							value={form.type}
							onChange={(e) =>
								setForm({ ...form, type: e.target.value as LicenseType })
							}
							className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-card"
						>
							{LICENSE_TYPES.map((t) => (
								<option key={t.value} value={t.value}>
									{t.label}
								</option>
							))}
						</select>
					</div>
				</div>

				<div className="space-y-1.5">
					<label className="text-sm font-semibold text-foreground">
						License number
					</label>
					<input
						type="text"
						placeholder="Optional"
						value={form.license_number || ""}
						onChange={(e) =>
							setForm({ ...form, license_number: e.target.value })
						}
						className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
					/>
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div className="space-y-1.5">
						<label className="text-sm font-semibold text-foreground">
							Issue date
						</label>
						<input
							type="date"
							value={form.issue_date || ""}
							onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
							className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none text-foreground"
						/>
					</div>
					<div className="space-y-1.5">
						<label className="text-sm font-semibold text-foreground">
							Expiry date
						</label>
						<input
							type="date"
							value={form.expiry_date || ""}
							onChange={(e) =>
								setForm({ ...form, expiry_date: e.target.value })
							}
							className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent outline-none text-foreground"
						/>
					</div>
				</div>

				<div className="pt-4 flex justify-end gap-3 border-t border-border">
					<button
						type="button"
						onClick={onClose}
						disabled={isSaving}
						className="px-5 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-full transition-colors"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={isSaving || !form.name || !form.issuing_authority}
						className="flex items-center gap-2 px-5 py-2 bg-muted text-muted-foreground text-sm font-medium rounded-full hover:bg-primary hover:text-white disabled:opacity-50 disabled:hover:bg-muted disabled:hover:text-muted-foreground transition-colors"
					>
						{isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
						Save
					</button>
				</div>
			</form>
		</ProfileModal>
	);
}
