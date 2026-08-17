import { useId, useRef, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import type { EvidenceCategory } from "@/services/delivery.service";
import {
	FieldError,
	FieldLabel,
	inputClassFor,
	PrimaryButton,
	SecondaryButton,
} from "./DeliveryPrimitives";
import {
	EVIDENCE_LABEL_MAX,
	type EvidenceFormErrors,
	validateEvidenceForm,
} from "./deliverableForm";

export const EVIDENCE_LABELS: Record<EvidenceCategory, string> = {
	github: "GitHub",
	figma: "Figma",
	deployment: "Deployment",
	docs: "Documentation",
	demo: "Demo",
	other: "Other",
};

const EVIDENCE_HINT: Record<EvidenceCategory, string> = {
	github: "A pull request, commit, or repository.",
	figma: "The design file a reviewer should open.",
	deployment: "Where the running thing can be seen.",
	docs: "Written documentation or a spec.",
	demo: "A recording or walkthrough.",
	other: "Anything else that proves the work.",
};

/** Attaching proof, as a dialog — the old inline four-column row was unreadable below `sm`. */
export function AddEvidenceModal({
	isOpen,
	pending,
	onClose,
	onSubmit,
}: {
	isOpen: boolean;
	pending: boolean;
	onClose: () => void;
	onSubmit: (body: {
		kind: "link";
		url: string;
		category: EvidenceCategory;
		label?: string;
	}) => void;
}) {
	const [url, setUrl] = useState("");
	const [label, setLabel] = useState("");
	const [category, setCategory] = useState<EvidenceCategory>("github");
	const [errors, setErrors] = useState<EvidenceFormErrors>({});
	const [submitted, setSubmitted] = useState(false);
	const urlRef = useRef<HTMLInputElement>(null);
	const formId = useId();

	const revalidate = (next: {
		url: string;
		label: string;
		category: EvidenceCategory;
	}) => {
		if (submitted) setErrors(validateEvidenceForm(next));
	};

	const close = () => {
		setUrl("");
		setLabel("");
		setCategory("github");
		setErrors({});
		setSubmitted(false);
		onClose();
	};

	return (
		<AppDialog
			open={isOpen}
			onClose={close}
			busy={pending}
			initialFocusRef={urlRef}
			title="Attach evidence"
			description="Proof the work is done — a pull request, a design file, a deployment. “Done” on its own isn’t reviewable."
			footer={
				<>
					<SecondaryButton onClick={close} disabled={pending}>
						Cancel
					</SecondaryButton>
					<PrimaryButton type="submit" form={formId} loading={pending}>
						Attach
					</PrimaryButton>
				</>
			}
		>
			<form
				id={formId}
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					setSubmitted(true);
					const found = validateEvidenceForm({ url, label, category });
					setErrors(found);
					if (Object.keys(found).length > 0) {
						urlRef.current?.focus();
						return;
					}
					onSubmit({
						kind: "link",
						url: url.trim(),
						category,
						label: label.trim() || undefined,
					});
				}}
			>
				<div className="mb-4">
					<FieldLabel>Kind</FieldLabel>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
						{(Object.keys(EVIDENCE_LABELS) as EvidenceCategory[]).map(
							(value) => (
								<button
									key={value}
									type="button"
									onClick={() => setCategory(value)}
									aria-pressed={category === value}
									className={`rounded-lg border px-3 py-2 text-left text-xs font-semibold transition ${
										category === value
											? "border-primary bg-primary/10 text-primary"
											: "border-border text-muted-foreground hover:bg-muted"
									}`}
								>
									{EVIDENCE_LABELS[value]}
								</button>
							),
						)}
					</div>
					<p className="mt-1.5 text-[11px] text-muted-foreground">
						{EVIDENCE_HINT[category]}
					</p>
				</div>

				<div className="mb-4">
					<FieldLabel>Link</FieldLabel>
					<input
						ref={urlRef}
						value={url}
						onChange={(event) => {
							setUrl(event.target.value);
							revalidate({ url: event.target.value, label, category });
						}}
						className={inputClassFor(errors.url)}
						aria-invalid={Boolean(errors.url)}
						placeholder="https://github.com/org/repo/pull/42"
					/>
					<FieldError>{errors.url}</FieldError>
				</div>

				<div>
					<FieldLabel>Label</FieldLabel>
					<input
						value={label}
						maxLength={EVIDENCE_LABEL_MAX + 1}
						onChange={(event) => {
							setLabel(event.target.value);
							revalidate({ url, label: event.target.value, category });
						}}
						className={inputClassFor(errors.label)}
						aria-invalid={Boolean(errors.label)}
						placeholder="Optional — what a reviewer will find there"
					/>
					<FieldError>{errors.label}</FieldError>
				</div>
			</form>
		</AppDialog>
	);
}
