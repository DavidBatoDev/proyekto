import { useEffect } from "react";
import { RichTextEditor } from "@/components/common/RichTextEditor";
export interface EditableRichSectionProps {
	value: string;
	placeholder: string;
	emptyText: string;
	isSaving: boolean;
	isEditing: boolean;
	draft: string;
	setDraft: (value: string) => void;
}

export function EditableRichSection({
	value,
	placeholder,
	emptyText,
	isSaving,
	isEditing,
	draft,
	setDraft,
}: EditableRichSectionProps) {
	useEffect(() => {
		if (!isEditing && draft !== value) {
			setDraft(value);
		}
	}, [draft, value, isEditing, setDraft]);

	const hasContent = Boolean(value.trim());

	if (isEditing) {
		return (
			<div className="space-y-3">
				<RichTextEditor
					value={draft}
					onChange={setDraft}
					placeholder={placeholder}
					minHeight="120px"
					maxHeight="320px"
					tools={[
						"textFormat",
						"bold",
						"italic",
						"more",
						"separator",
						"bulletList",
						"numberedList",
						"separator",
						"link",
					]}
					disabled={isSaving}
					autoFocus
				/>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{hasContent ? (
				<div
					className="text-[13px] text-gray-600 leading-6 max-w-none wrap-break-word [&_p]:my-0 [&_p+_p]:mt-3 [&_a]:text-blue-600 [&_a]:underline [&_strong]:font-semibold [&_b]:font-semibold [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1"
					dangerouslySetInnerHTML={{ __html: value }}
				/>
			) : (
				<p className="text-[13px] text-gray-500">{emptyText}</p>
			)}
		</div>
	);
}
