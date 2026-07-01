import {
	Loader2,
	QrCode,
	Save,
	Trash2,
	Upload,
	Wallet,
	X,
	XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
	CreatePayoutMethodInput,
	PayoutMethod,
	PayoutMethodType,
} from "@/services/payouts.service";
import { uploadService } from "@/services/upload.service";

const METHOD_OPTIONS: { value: PayoutMethodType; label: string }[] = [
	{ value: "bank", label: "Bank account" },
	{ value: "gcash", label: "GCash" },
	{ value: "maya", label: "Maya" },
	{ value: "paypal", label: "PayPal" },
	{ value: "other", label: "Other" },
];

interface PayoutMethodModalProps {
	isOpen: boolean;
	initial?: PayoutMethod | null;
	onClose: () => void;
	onSave: (input: CreatePayoutMethodInput) => void;
	isSaving: boolean;
}

export function PayoutMethodModal({
	isOpen,
	initial,
	onClose,
	onSave,
	isSaving,
}: PayoutMethodModalProps) {
	const [methodType, setMethodType] = useState<PayoutMethodType>("gcash");
	const [label, setLabel] = useState("");
	const [accountName, setAccountName] = useState("");
	const [accountIdentifier, setAccountIdentifier] = useState("");
	const [bankName, setBankName] = useState("");
	const [currency, setCurrency] = useState("");
	const [isDefault, setIsDefault] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// QR: existing presigned url (edit), a newly picked file, a remove flag, and
	// a local preview url for the picked file.
	const [existingQrUrl, setExistingQrUrl] = useState<string | null>(null);
	const [qrFile, setQrFile] = useState<File | null>(null);
	const [qrLocalUrl, setQrLocalUrl] = useState<string | null>(null);
	const [removeQr, setRemoveQr] = useState(false);
	const [uploadingQr, setUploadingQr] = useState(false);

	useEffect(() => {
		if (!isOpen) return;
		setMethodType(initial?.method_type ?? "gcash");
		setLabel(initial?.label ?? "");
		setAccountName(initial?.account_name ?? "");
		setAccountIdentifier(initial?.account_identifier ?? "");
		setBankName(initial?.bank_name ?? "");
		setCurrency(initial?.currency ?? "");
		setIsDefault(initial?.is_default ?? false);
		setExistingQrUrl(initial?.qr_url ?? null);
		setQrFile(null);
		setRemoveQr(false);
		setUploadingQr(false);
		setError(null);
	}, [isOpen, initial]);

	// Manage the object URL for a locally-picked QR file.
	useEffect(() => {
		if (!qrFile) {
			setQrLocalUrl(null);
			return;
		}
		const url = URL.createObjectURL(qrFile);
		setQrLocalUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [qrFile]);

	if (!isOpen) return null;

	const qrPreview = qrLocalUrl ?? (removeQr ? null : existingQrUrl);

	const identifierLabel =
		methodType === "bank"
			? "Account number"
			: methodType === "paypal"
				? "PayPal email"
				: methodType === "other"
					? "Account / identifier"
					: "Mobile number";

	const handleSave = async () => {
		if (!accountName.trim() || !accountIdentifier.trim()) {
			setError("Account name and number/identifier are required.");
			return;
		}
		if (methodType === "bank" && !bankName.trim()) {
			setError("Bank name is required for bank accounts.");
			return;
		}

		let qr_path: string | undefined;
		if (qrFile) {
			setUploadingQr(true);
			try {
				qr_path = await uploadService.uploadPayoutQr(qrFile);
			} catch (e) {
				setError((e as Error).message || "Failed to upload QR image.");
				setUploadingQr(false);
				return;
			}
			setUploadingQr(false);
		} else if (removeQr && initial?.qr_path) {
			qr_path = ""; // clear the existing QR
		}

		onSave({
			method_type: methodType,
			label: label.trim() || undefined,
			account_name: accountName.trim(),
			account_identifier: accountIdentifier.trim(),
			bank_name: methodType === "bank" ? bankName.trim() : undefined,
			currency: currency.trim() || undefined,
			qr_path,
			is_default: isDefault,
		});
	};

	return (
		<div
			className="fixed inset-0 z-165 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-[2px]"
			onClick={onClose}
		>
			<div
				className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
					<h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
						<Wallet className="h-4 w-4 text-indigo-600" />
						{initial ? "Edit payout method" : "Add payout method"}
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="space-y-3 p-5">
					<Field label="Type">
						<select
							value={methodType}
							onChange={(e) =>
								setMethodType(e.target.value as PayoutMethodType)
							}
							className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
						>
							{METHOD_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</select>
					</Field>

					<Field label="Nickname (optional)">
						<input
							type="text"
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="e.g. Payroll account"
							className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
						/>
					</Field>

					{methodType === "bank" && (
						<Field label="Bank name">
							<input
								type="text"
								value={bankName}
								onChange={(e) => setBankName(e.target.value)}
								placeholder="e.g. BPI"
								className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
							/>
						</Field>
					)}

					<Field label="Account name">
						<input
							type="text"
							value={accountName}
							onChange={(e) => setAccountName(e.target.value)}
							placeholder="Name on the account"
							className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
						/>
					</Field>

					<Field label={identifierLabel}>
						<input
							type="text"
							value={accountIdentifier}
							onChange={(e) => setAccountIdentifier(e.target.value)}
							className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
						/>
					</Field>

					<Field label="Currency (optional)">
						<input
							type="text"
							value={currency}
							onChange={(e) => setCurrency(e.target.value.toUpperCase())}
							placeholder="e.g. PHP"
							maxLength={10}
							className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
						/>
					</Field>

					<Field label="Scan-to-pay QR (optional)">
						{qrPreview ? (
							<div className="flex items-start gap-3">
								<img
									src={qrPreview}
									alt="Payout QR"
									className="h-28 w-28 rounded-lg border border-slate-200 bg-white object-contain p-1"
								/>
								<div className="space-y-1.5">
									<p className="text-xs text-slate-500">
										Payers can scan this to pay you faster.
									</p>
									<button
										type="button"
										onClick={() => {
											setQrFile(null);
											setRemoveQr(true);
										}}
										className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100"
									>
										<Trash2 className="h-3.5 w-3.5" />
										Remove
									</button>
								</div>
							</div>
						) : (
							<label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-xs text-slate-600 hover:bg-slate-50">
								<QrCode className="h-4 w-4 text-slate-400" />
								<span className="inline-flex items-center gap-1">
									<Upload className="h-3.5 w-3.5" />
									Upload GCash / Maya / bank QR image
								</span>
								<input
									type="file"
									accept="image/*"
									className="hidden"
									onChange={(e) => {
										const file = e.target.files?.[0] ?? null;
										if (file) {
											setQrFile(file);
											setRemoveQr(false);
										}
									}}
								/>
							</label>
						)}
					</Field>

					<label className="flex items-center gap-2 text-sm text-slate-700">
						<input
							type="checkbox"
							checked={isDefault}
							onChange={(e) => setIsDefault(e.target.checked)}
							className="h-3.5 w-3.5 rounded border-slate-300"
						/>
						Set as default payout method
					</label>

					{error && <p className="text-xs text-rose-600">{error}</p>}
				</div>

				<div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
					<button
						type="button"
						onClick={onClose}
						disabled={isSaving}
						className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
					>
						<XCircle className="h-3.5 w-3.5" />
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void handleSave()}
						disabled={isSaving || uploadingQr}
						className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
					>
						{isSaving || uploadingQr ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Save className="h-3.5 w-3.5" />
						)}
						{uploadingQr ? "Uploading…" : "Save"}
					</button>
				</div>
			</div>
		</div>
	);
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-1.5">
			<label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
				{label}
			</label>
			{children}
		</div>
	);
}
