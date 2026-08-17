import { CalendarRange, Clock, Send } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import type { ChangeRequest } from "@/services/delivery.service";
import {
	type ChangeRequestFormErrors,
	type ChangeRequestFormValues,
	CR_TITLE_MAX,
	changeRequestToForm,
	EMPTY_CHANGE_REQUEST_FORM,
	hasChangeRequestErrors,
	toChangeRequestCreatePayload,
	toChangeRequestUpdatePayload,
	validateChangeRequestForm,
} from "./changeRequestForm";
import { timelineImpact } from "./changeRequestModel";
import {
	FieldError,
	FieldLabel,
	inputClassFor,
	PrimaryButton,
	SecondaryButton,
} from "./DeliveryPrimitives";

/**
 * Raising and editing a change request, as a dialog.
 *
 * One component for both modes rather than two near-identical forms: the fields,
 * the validation and the payload shape are the same, and only the footer verbs
 * and the title differ. Passing a `request` puts it in edit mode.
 *
 * Validation runs on submit and then live per keystroke, so a first attempt is
 * not nagged at while it is being typed but a correction clears immediately. The
 * submit buttons stay enabled with an empty title on purpose — a disabled button
 * that never says why is the most common way a form dead-ends.
 */
export function ChangeRequestFormModal({
	isOpen,
	pending,
	request,
	onClose,
	onCreate,
	onUpdate,
}: {
	isOpen: boolean;
	pending: boolean;
	/** Present in edit mode; absent when raising a new one. */
	request?: ChangeRequest | null;
	onClose: () => void;
	onCreate: (body: ReturnType<typeof toChangeRequestCreatePayload>) => void;
	onUpdate: (body: ReturnType<typeof toChangeRequestUpdatePayload>) => void;
}) {
	const isEditing = Boolean(request);
	const [values, setValues] = useState<ChangeRequestFormValues>(
		EMPTY_CHANGE_REQUEST_FORM,
	);
	const [errors, setErrors] = useState<ChangeRequestFormErrors>({});
	const [submitted, setSubmitted] = useState(false);
	const titleRef = useRef<HTMLInputElement>(null);
	const fieldId = useId();

	// Reload whenever the dialog opens on a different request, so reopening Edit
	// on another row never shows the previous one's values.
	useEffect(() => {
		if (!isOpen) return;
		setValues(
			request ? changeRequestToForm(request) : EMPTY_CHANGE_REQUEST_FORM,
		);
		setErrors({});
		setSubmitted(false);
	}, [isOpen, request]);

	const revalidate = (next: ChangeRequestFormValues) => {
		setValues(next);
		if (submitted) setErrors(validateChangeRequestForm(next));
	};

	const set = <K extends keyof ChangeRequestFormValues>(
		key: K,
		value: ChangeRequestFormValues[K],
	) => revalidate({ ...values, [key]: value });

	const close = () => {
		setErrors({});
		setSubmitted(false);
		onClose();
	};

	/** Shared gate: validate, focus the first bad field, or hand the payload on. */
	const attempt = (then: (checked: ChangeRequestFormValues) => void) => {
		setSubmitted(true);
		const found = validateChangeRequestForm(values);
		setErrors(found);
		if (hasChangeRequestErrors(found)) {
			if (found.title) titleRef.current?.focus();
			return;
		}
		then(values);
	};

	const submitForDecision = () =>
		attempt((checked) => {
			if (isEditing) onUpdate(toChangeRequestUpdatePayload(checked));
			else onCreate(toChangeRequestCreatePayload(checked, { submit: true }));
		});

	const saveDraft = () =>
		attempt((checked) => {
			if (isEditing) onUpdate(toChangeRequestUpdatePayload(checked));
			else onCreate(toChangeRequestCreatePayload(checked, { submit: false }));
		});

	// Live echo of what the numbers mean, so the consequence is visible while it
	// is being typed rather than only after saving.
	const impactPreview = values.impactDays.trim()
		? timelineImpact(
				/^-?\d+$/.test(values.impactDays.trim())
					? Number(values.impactDays)
					: null,
			)
		: null;

	return (
		<AppDialog
			open={isOpen}
			onClose={close}
			busy={pending}
			size="lg"
			initialFocusRef={titleRef}
			title={isEditing ? "Edit change request" : "Raise a change request"}
			description={
				isEditing
					? "Update what is being asked for and what it does to the schedule."
					: "Work outside the agreed scope. Record what changes and what it costs the schedule, so 'can you just add this' stops being invisible."
			}
			footer={
				<>
					<SecondaryButton onClick={close} disabled={pending}>
						Cancel
					</SecondaryButton>
					{!isEditing && (
						<SecondaryButton onClick={saveDraft} disabled={pending}>
							Save as draft
						</SecondaryButton>
					)}
					<PrimaryButton
						type="submit"
						form={`${fieldId}-form`}
						loading={pending}
					>
						{!isEditing && <Send className="h-4 w-4" />}
						{isEditing ? "Save changes" : "Submit for decision"}
					</PrimaryButton>
				</>
			}
		>
			<form
				id={`${fieldId}-form`}
				onSubmit={(event) => {
					event.preventDefault();
					submitForDecision();
				}}
				noValidate
			>
				<div className="mb-4">
					<FieldLabel>What is being asked for?</FieldLabel>
					<input
						ref={titleRef}
						value={values.title}
						onChange={(event) => set("title", event.target.value)}
						maxLength={CR_TITLE_MAX + 1}
						className={inputClassFor(errors.title)}
						aria-invalid={Boolean(errors.title)}
						aria-describedby={
							errors.title ? `${fieldId}-title-error` : undefined
						}
						placeholder="Add Google sign-in"
					/>
					<FieldError id={`${fieldId}-title-error`}>{errors.title}</FieldError>
				</div>

				<div className="mb-4">
					<FieldLabel>Why is it needed?</FieldLabel>
					<textarea
						value={values.description}
						onChange={(event) => set("description", event.target.value)}
						rows={3}
						className={inputClassFor(errors.description)}
						aria-invalid={Boolean(errors.description)}
						placeholder="Reduce registration friction and improve conversion during onboarding."
					/>
					<FieldError>{errors.description}</FieldError>
				</div>

				<div className="mb-5">
					<FieldLabel>What changes in the plan?</FieldLabel>
					<textarea
						value={values.impactScope}
						onChange={(event) => set("impactScope", event.target.value)}
						rows={2}
						className={inputClassFor(errors.impactScope)}
						aria-invalid={Boolean(errors.impactScope)}
						placeholder="One new feature under the Authentication epic, plus six tasks."
					/>
					<FieldError>{errors.impactScope}</FieldError>
				</div>

				{/* Impact is its own block: these three fields are the argument the
				    approver actually weighs, so they read as a unit rather than as
				    three more rows in a long form. */}
				<fieldset className="rounded-xl border border-border bg-muted/30 p-4">
					<legend className="flex items-center gap-1.5 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						<Clock className="h-3.5 w-3.5" />
						Schedule impact
					</legend>

					<div className="mb-4 max-w-[13rem]">
						<FieldLabel>Days added</FieldLabel>
						<input
							type="number"
							inputMode="numeric"
							value={values.impactDays}
							onChange={(event) => set("impactDays", event.target.value)}
							className={inputClassFor(errors.impactDays)}
							aria-invalid={Boolean(errors.impactDays)}
							placeholder="5"
						/>
						<FieldError>{errors.impactDays}</FieldError>
						{!errors.impactDays && (
							<span className="mt-1 block text-[11px] text-muted-foreground">
								{impactPreview ?? "Negative pulls the schedule in."}
							</span>
						)}
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<div>
							<FieldLabel>
								<span className="inline-flex items-center gap-1.5">
									<CalendarRange className="h-3.5 w-3.5" />
									Target date now
								</span>
							</FieldLabel>
							<input
								type="date"
								value={values.targetDateBefore}
								onChange={(event) =>
									set("targetDateBefore", event.target.value)
								}
								className={inputClassFor(errors.targetDateBefore)}
								aria-invalid={Boolean(errors.targetDateBefore)}
							/>
							<FieldError>{errors.targetDateBefore}</FieldError>
						</div>
						<div>
							<FieldLabel>If this is approved</FieldLabel>
							<input
								type="date"
								value={values.targetDateAfter}
								onChange={(event) => set("targetDateAfter", event.target.value)}
								className={inputClassFor(errors.targetDateAfter)}
								aria-invalid={Boolean(errors.targetDateAfter)}
							/>
							<FieldError>{errors.targetDateAfter}</FieldError>
						</div>
					</div>
				</fieldset>
			</form>
		</AppDialog>
	);
}
