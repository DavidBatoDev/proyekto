import { Award, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { UserCertification } from "@/services/profile.service";
import { ProfileModal } from "./ProfileModal";

type CertPayload = Omit<
	UserCertification,
	"id" | "user_id" | "is_verified" | "created_at" | "updated_at"
>;

interface Props {
	isOpen: boolean;
	onClose: () => void;
	onSave: (payload: CertPayload) => void;
	isSaving?: boolean;
	initialData?: Partial<UserCertification>;
}

const empty: CertPayload = {
	name: "",
	issuer: "",
	issue_date: null,
	expiry_date: null,
	credential_id: null,
	credential_url: null,
};

export function CertificationModal({
	isOpen,
	onClose,
	onSave,
	isSaving,
	initialData,
}: Props) {
	const isEdit = !!initialData;
	const [form, setForm] = useState<CertPayload>(empty);
	const set = (k: keyof CertPayload, v: unknown) =>
		setForm((p) => ({ ...p, [k]: v }));

	useEffect(() => {
		if (isOpen) {
			setForm(
				initialData
					? {
							name: initialData.name ?? "",
							issuer: initialData.issuer ?? "",
							issue_date: initialData.issue_date ?? null,
							expiry_date: initialData.expiry_date ?? null,
							credential_id: initialData.credential_id ?? null,
							credential_url: initialData.credential_url ?? null,
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
		if (!form.name.trim() || !form.issuer.trim()) return;
		onSave(form);
	};

	const cls =
		"w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

	return (
		<ProfileModal
			isOpen={isOpen}
			onClose={handleClose}
			title={isEdit ? "Edit Certification" : "Add Certification"}
		>
			<div className="space-y-4">
				<div>
					<label className="block text-xs font-medium text-muted-foreground mb-1">
						Certification Name <span className="text-destructive">*</span>
					</label>
					<input
						value={form.name}
						onChange={(e) => set("name", e.target.value)}
						className={cls}
						placeholder="e.g. AWS Solutions Architect – Associate"
					/>
				</div>
				<div>
					<label className="block text-xs font-medium text-muted-foreground mb-1">
						Issuing Organization <span className="text-destructive">*</span>
					</label>
					<input
						value={form.issuer}
						onChange={(e) => set("issuer", e.target.value)}
						className={cls}
						placeholder="e.g. Amazon Web Services"
					/>
				</div>

				<div className="grid grid-cols-2 gap-3">
					<div>
						<label className="block text-xs font-medium text-muted-foreground mb-1">
							Issue Date
						</label>
						<input
							type="month"
							value={form.issue_date?.slice(0, 7) ?? ""}
							onChange={(e) =>
								set(
									"issue_date",
									e.target.value ? e.target.value + "-01" : null,
								)
							}
							className={cls}
						/>
					</div>
					<div>
						<label className="block text-xs font-medium text-muted-foreground mb-1">
							Expiry Date{" "}
							<span className="text-muted-foreground font-normal">
								(optional)
							</span>
						</label>
						<input
							type="month"
							value={form.expiry_date?.slice(0, 7) ?? ""}
							onChange={(e) =>
								set(
									"expiry_date",
									e.target.value ? e.target.value + "-01" : null,
								)
							}
							className={cls}
						/>
					</div>
				</div>

				<div>
					<label className="block text-xs font-medium text-muted-foreground mb-1">
						Credential ID{" "}
						<span className="text-muted-foreground font-normal">
							(optional)
						</span>
					</label>
					<input
						value={form.credential_id ?? ""}
						onChange={(e) => set("credential_id", e.target.value || null)}
						className={cls}
						placeholder="e.g. ABC-123-XYZ"
					/>
				</div>
				<div>
					<label className="block text-xs font-medium text-muted-foreground mb-1">
						Credential URL{" "}
						<span className="text-muted-foreground font-normal">
							(public verification link)
						</span>
					</label>
					<input
						type="url"
						value={form.credential_url ?? ""}
						onChange={(e) => set("credential_url", e.target.value || null)}
						className={cls}
						placeholder="https://www.credly.com/badges/..."
					/>
				</div>

				<div className="flex justify-end gap-3 pt-2">
					<button
						onClick={handleClose}
						className="px-5 py-2 text-sm border border-input text-muted-foreground rounded-lg hover:bg-muted/40 transition-colors"
					>
						Cancel
					</button>
					<button
						onClick={handleSave}
						disabled={isSaving || !form.name.trim() || !form.issuer.trim()}
						className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors flex items-center gap-2"
					>
						{isSaving ? (
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
						) : (
							<Award className="w-3.5 h-3.5" />
						)}
						{isSaving
							? "Saving…"
							: isEdit
								? "Save Changes"
								: "Add Certification"}
					</button>
				</div>
			</div>
		</ProfileModal>
	);
}
