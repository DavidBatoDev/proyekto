import { GripVertical, Plus, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import {
	FieldError,
	FieldLabel,
	inputClassFor,
	PrimaryButton,
	SecondaryButton,
} from "./DeliveryPrimitives";
import {
	type DeliverableFormErrors,
	EMPTY_DELIVERABLE_FORM,
	hasErrors,
	TITLE_MAX,
	toCreatePayload,
	todayIsoDate,
	validateDeliverableForm,
} from "./deliverableForm";

/**
 * Creating a deliverable, as a dialog rather than a card that pushed the list
 * down the page.
 *
 * Validation runs on submit and then live per keystroke, so the first attempt
 * isn't nagged at while it's being typed but a correction clears immediately.
 * The submit button stays enabled with an empty title on purpose: a disabled
 * button that never says why is the most common way a form dead-ends.
 */
export function CreateDeliverableModal({
	isOpen,
	pending,
	onClose,
	onSubmit,
}: {
	isOpen: boolean;
	pending: boolean;
	onClose: () => void;
	onSubmit: (body: {
		title: string;
		description?: string;
		due_date?: string;
		criteria?: string[];
	}) => void;
}) {
	const [values, setValues] = useState(EMPTY_DELIVERABLE_FORM);
	const [errors, setErrors] = useState<DeliverableFormErrors>({});
	const [submitted, setSubmitted] = useState(false);
	const titleRef = useRef<HTMLInputElement>(null);
	const fieldId = useId();

	const revalidate = (next: typeof values) => {
		setValues(next);
		if (submitted) setErrors(validateDeliverableForm(next));
	};

	const setCriterion = (index: number, text: string) =>
		revalidate({
			...values,
			criteria: values.criteria.map((c, i) => (i === index ? text : c)),
		});

	const addRow = () =>
		revalidate({ ...values, criteria: [...values.criteria, ""] });

	const removeRow = (index: number) =>
		revalidate({
			...values,
			criteria:
				values.criteria.length === 1
					? [""]
					: values.criteria.filter((_, i) => i !== index),
		});

	const close = () => {
		setValues(EMPTY_DELIVERABLE_FORM);
		setErrors({});
		setSubmitted(false);
		onClose();
	};

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		setSubmitted(true);
		const found = validateDeliverableForm(values);
		setErrors(found);
		if (hasErrors(found)) {
			if (found.title) titleRef.current?.focus();
			return;
		}
		onSubmit(toCreatePayload(values));
	};

	const filledCriteria = values.criteria.filter((c) => c.trim()).length;

	return (
		<AppDialog
			open={isOpen}
			onClose={close}
			busy={pending}
			size="lg"
			initialFocusRef={titleRef}
			title="New deliverable"
			description="Something the project hands over and someone accepts — a design, a build, a deployment."
			footer={
				<>
					<SecondaryButton onClick={close} disabled={pending}>
						Cancel
					</SecondaryButton>
					<PrimaryButton
						type="submit"
						form={`${fieldId}-form`}
						loading={pending}
					>
						Create deliverable
					</PrimaryButton>
				</>
			}
		>
			<form id={`${fieldId}-form`} onSubmit={handleSubmit} noValidate>
				<div className="mb-4">
					<FieldLabel>Title</FieldLabel>
					<input
						ref={titleRef}
						value={values.title}
						onChange={(event) =>
							revalidate({ ...values, title: event.target.value })
						}
						maxLength={TITLE_MAX + 1}
						className={inputClassFor(errors.title)}
						aria-invalid={Boolean(errors.title)}
						aria-describedby={
							errors.title ? `${fieldId}-title-error` : undefined
						}
						placeholder="Backend API"
					/>
					<FieldError id={`${fieldId}-title-error`}>{errors.title}</FieldError>
				</div>

				<div className="mb-4">
					<FieldLabel>Description</FieldLabel>
					<textarea
						value={values.description}
						onChange={(event) =>
							revalidate({ ...values, description: event.target.value })
						}
						rows={3}
						className={inputClassFor(errors.description)}
						aria-invalid={Boolean(errors.description)}
						placeholder="What is being handed over, and what does accepting it mean?"
					/>
					<FieldError>{errors.description}</FieldError>
				</div>

				<div className="mb-4">
					<div className="mb-1 flex items-center justify-between">
						<FieldLabel>Acceptance criteria</FieldLabel>
						<span className="text-[11px] font-semibold text-muted-foreground">
							{filledCriteria === 0
								? "Optional — add them later"
								: `${filledCriteria} listed`}
						</span>
					</div>
					<div className="space-y-2">
						{values.criteria.map((criterion, index) => {
							const rowError = errors.criteriaRows?.[index];
							return (
								// Rows are positional and have no id until saved; every input
								// is controlled from `values`, so an index key is safe here.
								<div key={index} className="rounded-lg">
									<div className="flex items-center gap-2">
										<GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50" />
										<input
											value={criterion}
											onChange={(event) =>
												setCriterion(index, event.target.value)
											}
											onKeyDown={(event) => {
												// Enter adds the next row instead of submitting the
												// whole form halfway through a checklist.
												if (event.key === "Enter") {
													event.preventDefault();
													addRow();
												}
											}}
											className={inputClassFor(rowError)}
											aria-invalid={Boolean(rowError)}
											aria-label={`Acceptance criterion ${index + 1}`}
											placeholder="Deployed to production"
										/>
										<button
											type="button"
											onClick={() => removeRow(index)}
											className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-destructive"
											aria-label={`Remove criterion ${index + 1}`}
										>
											<X className="h-4 w-4" />
										</button>
									</div>
									{rowError && (
										<div className="pl-6">
											<FieldError>{rowError}</FieldError>
										</div>
									)}
								</div>
							);
						})}
					</div>
					<button
						type="button"
						onClick={addRow}
						className="mt-2 inline-flex items-center gap-1 pl-6 text-xs font-semibold text-primary hover:underline"
					>
						<Plus className="h-3.5 w-3.5" />
						Add criterion
					</button>
				</div>

				<div className="max-w-xs">
					<FieldLabel>Due date</FieldLabel>
					<input
						type="date"
						value={values.dueDate}
						min={todayIsoDate()}
						onChange={(event) =>
							revalidate({ ...values, dueDate: event.target.value })
						}
						className={inputClassFor(errors.dueDate)}
						aria-invalid={Boolean(errors.dueDate)}
					/>
					<FieldError>{errors.dueDate}</FieldError>
				</div>
			</form>
		</AppDialog>
	);
}
