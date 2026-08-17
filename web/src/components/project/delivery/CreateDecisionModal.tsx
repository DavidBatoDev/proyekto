import { CircleCheck, CircleDashed, Lock, Plus, Users, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import type {
	CreateDecisionBody,
	DecisionCategory,
} from "@/services/delivery.service";
import { CategoryCombobox } from "./CategoryCombobox";
import {
	FieldError,
	FieldLabel,
	inputClassFor,
	PrimaryButton,
	SecondaryButton,
} from "./DeliveryPrimitives";
import {
	DECISION_TITLE_MAX,
	type DecisionFormErrors,
	type DecisionFormValues,
	EMPTY_DECISION_FORM,
	hasDecisionErrors,
	OPTION_TITLE_MAX,
	toCreateDecisionPayload,
	validateDecisionForm,
} from "./decisionForm";

/**
 * Recording a decision.
 *
 * The form is ordered the way the question is actually asked: what was decided,
 * then why, then what else was on the table. `alternatives_considered` is
 * deliberately absent — options replaced it, and offering both would leave two
 * places to write the same thing.
 *
 * Validation runs on submit and then live per keystroke, and the submit button
 * stays enabled on an empty title: a disabled button that never says why is the
 * most common way a form dead-ends. Same contract as `CreateDeliverableModal`.
 */
export function CreateDecisionModal({
	isOpen,
	pending,
	categories,
	creatingCategory,
	supersedesTitle,
	onCreateCategory,
	onClose,
	onSubmit,
}: {
	isOpen: boolean;
	pending: boolean;
	categories: DecisionCategory[];
	creatingCategory: boolean;
	/** Set when this decision will replace another one. */
	supersedesTitle: string | null;
	onCreateCategory: (input: {
		name: string;
		color?: DecisionCategory["color"];
		icon?: DecisionCategory["icon"];
	}) => Promise<DecisionCategory | null>;
	onClose: () => void;
	onSubmit: (body: CreateDecisionBody) => void;
}) {
	const [values, setValues] = useState<DecisionFormValues>(EMPTY_DECISION_FORM);
	const [errors, setErrors] = useState<DecisionFormErrors>({});
	const [submitted, setSubmitted] = useState(false);
	const titleRef = useRef<HTMLInputElement>(null);
	const fieldId = useId();

	const revalidate = (next: DecisionFormValues) => {
		setValues(next);
		if (submitted) setErrors(validateDecisionForm(next));
	};

	const setOption = (
		index: number,
		patch: { title?: string; detail?: string },
	) =>
		revalidate({
			...values,
			options: values.options.map((option, i) =>
				i === index ? { ...option, ...patch } : option,
			),
		});

	const addRow = () =>
		revalidate({
			...values,
			options: [...values.options, { title: "", detail: "" }],
		});

	const removeRow = (index: number) =>
		revalidate({
			...values,
			options: values.options.filter((_, i) => i !== index),
			// The selection is an index, so removing a row above it would silently
			// move the tick onto a different option.
			selectedOption:
				values.selectedOption === null
					? null
					: values.selectedOption === index
						? null
						: values.selectedOption > index
							? values.selectedOption - 1
							: values.selectedOption,
		});

	const close = () => {
		setValues(EMPTY_DECISION_FORM);
		setErrors({});
		setSubmitted(false);
		onClose();
	};

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		setSubmitted(true);
		const found = validateDecisionForm(values);
		setErrors(found);
		if (hasDecisionErrors(found)) {
			if (found.title) titleRef.current?.focus();
			return;
		}
		onSubmit(toCreateDecisionPayload(values));
	};

	return (
		<AppDialog
			open={isOpen}
			onClose={close}
			busy={pending}
			size="lg"
			initialFocusRef={titleRef}
			title={supersedesTitle ? "Replace a decision" : "Record a decision"}
			description="What was chosen, why, and what else was on the table."
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
						{supersedesTitle ? "Replace it" : "Record it"}
					</PrimaryButton>
				</>
			}
		>
			<form id={`${fieldId}-form`} onSubmit={handleSubmit} noValidate>
				{supersedesTitle && (
					<p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-foreground">
						This replaces <strong>{supersedesTitle}</strong> and marks it
						superseded. The old decision stays readable as history.
					</p>
				)}

				<div className="mb-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
					<div>
						<FieldLabel>Title</FieldLabel>
						<input
							ref={titleRef}
							value={values.title}
							onChange={(event) =>
								revalidate({ ...values, title: event.target.value })
							}
							maxLength={DECISION_TITLE_MAX + 1}
							className={inputClassFor(errors.title)}
							aria-invalid={Boolean(errors.title)}
							aria-describedby={
								errors.title ? `${fieldId}-title-error` : undefined
							}
							placeholder="Database choice"
						/>
						<FieldError id={`${fieldId}-title-error`}>
							{errors.title}
						</FieldError>
					</div>
					<div>
						<FieldLabel>Category</FieldLabel>
						<CategoryCombobox
							categories={categories}
							value={values.categoryId}
							onChange={(categoryId) => revalidate({ ...values, categoryId })}
							onCreate={onCreateCategory}
							creating={creatingCategory}
						/>
					</div>
				</div>

				<div className="mb-4">
					<FieldLabel>The decision</FieldLabel>
					<textarea
						value={values.decision}
						onChange={(event) =>
							revalidate({ ...values, decision: event.target.value })
						}
						rows={2}
						className={inputClassFor(errors.decision)}
						aria-invalid={Boolean(errors.decision)}
						aria-describedby={
							errors.decision ? `${fieldId}-decision-error` : undefined
						}
						placeholder="Use PostgreSQL as the primary application database."
					/>
					<FieldError id={`${fieldId}-decision-error`}>
						{errors.decision}
					</FieldError>
				</div>

				<div className="mb-4 grid gap-4 sm:grid-cols-2">
					<div>
						<FieldLabel>Context</FieldLabel>
						<textarea
							value={values.context}
							onChange={(event) =>
								revalidate({ ...values, context: event.target.value })
							}
							rows={3}
							className={inputClassFor(errors.context)}
							placeholder="What forced the choice?"
						/>
						<FieldError>{errors.context}</FieldError>
					</div>
					<div>
						<FieldLabel>Why</FieldLabel>
						<textarea
							value={values.rationale}
							onChange={(event) =>
								revalidate({ ...values, rationale: event.target.value })
							}
							rows={3}
							className={inputClassFor(errors.rationale)}
							placeholder="The reasoning, so it survives the people who were in the room."
						/>
						<FieldError>{errors.rationale}</FieldError>
					</div>
				</div>

				<div className="mb-4">
					<div className="mb-1 flex items-center justify-between">
						<FieldLabel>Options considered</FieldLabel>
						<span className="text-[11px] font-semibold text-muted-foreground">
							{values.options.length === 0
								? "Optional"
								: "Tick the one that was chosen"}
						</span>
					</div>

					{values.options.length > 0 && (
						<div className="mb-2 flex flex-col gap-2">
							{values.options.map((option, index) => {
								const rowError = errors.optionRows?.[index];
								const chosen = values.selectedOption === index;
								return (
									// Keyed by index because these rows have no id until they are
									// saved, and the selection is itself an index.
									<div
										key={index}
										className={`rounded-lg border p-2 transition-colors ${
											chosen
												? "border-success/40 bg-success/5"
												: "border-border"
										}`}
									>
										<div className="flex items-center gap-2">
											<button
												type="button"
												onClick={() =>
													revalidate({
														...values,
														selectedOption: chosen ? null : index,
													})
												}
												aria-pressed={chosen}
												aria-label={
													chosen
														? "This was the chosen option"
														: "Mark this as the chosen option"
												}
												className="shrink-0 rounded-full p-0.5 transition-colors"
											>
												{chosen ? (
													<CircleCheck className="h-4 w-4 text-success" />
												) : (
													<CircleDashed className="h-4 w-4 text-muted-foreground hover:text-foreground" />
												)}
											</button>
											<input
												value={option.title}
												onChange={(event) =>
													setOption(index, { title: event.target.value })
												}
												onKeyDown={(event) => {
													// Enter adds the next row rather than submitting the
													// form half-filled.
													if (event.key === "Enter") {
														event.preventDefault();
														if (index === values.options.length - 1) addRow();
													}
												}}
												maxLength={OPTION_TITLE_MAX + 1}
												className={`${inputClassFor(rowError)} py-1.5`}
												aria-invalid={Boolean(rowError)}
												placeholder={
													index === 0 ? "PostgreSQL" : "The alternative"
												}
											/>
											<button
												type="button"
												onClick={() => removeRow(index)}
												aria-label="Remove this option"
												className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
											>
												<X className="h-3.5 w-3.5" />
											</button>
										</div>
										<input
											value={option.detail}
											onChange={(event) =>
												setOption(index, { detail: event.target.value })
											}
											className={`${inputClassFor(false)} mt-1.5 border-transparent bg-transparent py-1 text-xs shadow-none`}
											placeholder="What made it a contender, or what ruled it out"
										/>
										<FieldError>{rowError}</FieldError>
									</div>
								);
							})}
						</div>
					)}

					<button
						type="button"
						onClick={addRow}
						className="inline-flex items-center gap-1 text-xs font-semibold text-primary transition-opacity hover:opacity-80"
					>
						<Plus className="h-3.5 w-3.5" />
						{values.options.length === 0 ? "Add an option" : "Add another"}
					</button>
				</div>

				<div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
					<div>
						<FieldLabel>Status</FieldLabel>
						<div className="inline-flex rounded-lg bg-muted p-1">
							{(
								[
									{ key: "final", label: "Final", icon: CircleCheck },
									{ key: "proposed", label: "Proposed", icon: CircleDashed },
								] as const
							).map((choice) => {
								const Icon = choice.icon;
								const active = values.status === choice.key;
								return (
									<button
										key={choice.key}
										type="button"
										onClick={() =>
											revalidate({ ...values, status: choice.key })
										}
										aria-pressed={active}
										className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
											active
												? "bg-card text-foreground shadow-sm"
												: "text-muted-foreground hover:text-foreground"
										}`}
									>
										<Icon className="h-3.5 w-3.5" />
										{choice.label}
									</button>
								);
							})}
						</div>
						<p className="mt-1.5 text-[11px] text-muted-foreground">
							{values.status === "proposed"
								? "Still being argued. It shows under Needs attention until it's settled."
								: "Settled. This is the common case."}
						</p>
					</div>

					<div>
						<FieldLabel>Visibility</FieldLabel>
						<div className="inline-flex rounded-lg bg-muted p-1">
							{(
								[
									{ key: "shared", label: "Shared", icon: Users },
									{ key: "internal", label: "Internal", icon: Lock },
								] as const
							).map((choice) => {
								const Icon = choice.icon;
								const active = values.visibility === choice.key;
								return (
									<button
										key={choice.key}
										type="button"
										onClick={() =>
											revalidate({ ...values, visibility: choice.key })
										}
										aria-pressed={active}
										className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
											active
												? "bg-card text-foreground shadow-sm"
												: "text-muted-foreground hover:text-foreground"
										}`}
									>
										<Icon className="h-3.5 w-3.5" />
										{choice.label}
									</button>
								);
							})}
						</div>
						<p className="mt-1.5 text-[11px] text-muted-foreground">
							{values.visibility === "internal"
								? "Only members who can see internal decisions."
								: "Everyone on the project can read it."}
						</p>
					</div>
				</div>
			</form>
		</AppDialog>
	);
}
