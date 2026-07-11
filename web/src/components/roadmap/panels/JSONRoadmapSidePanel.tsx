import Editor from "@monaco-editor/react";
import { AnimatePresence, motion } from "framer-motion";
import { Code2, X } from "lucide-react";
import type * as Monaco from "monaco-editor";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useThemeMode } from "@/theme/useThemeMode";

interface JSONRoadmapSidePanelProps {
	isOpen: boolean;
	initialJson: string;
	isSaving?: boolean;
	onClose: () => void;
	onSave: (parsedJson: unknown) => Promise<void>;
}

export function JSONRoadmapSidePanel({
	isOpen,
	initialJson,
	isSaving = false,
	onClose,
	onSave,
}: JSONRoadmapSidePanelProps) {
	const themeMode = useThemeMode();
	const [jsonValue, setJsonValue] = useState(initialJson);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [editorInstance, setEditorInstance] =
		useState<Monaco.editor.IStandaloneCodeEditor | null>(null);

	useEffect(() => {
		if (!isOpen) return;
		setJsonValue(initialJson);
		setErrorMessage(null);
	}, [isOpen, initialJson]);

	useEffect(() => {
		if (!isOpen) return;

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !isSaving) {
				onClose();
			}
		};

		window.addEventListener("keydown", handleEscape);
		return () => window.removeEventListener("keydown", handleEscape);
	}, [isOpen, isSaving, onClose]);

	const handleSave = async () => {
		try {
			setErrorMessage(null);
			const parsed = JSON.parse(jsonValue);
			await onSave(parsed);
		} catch (error) {
			if (error instanceof SyntaxError) {
				setErrorMessage(`Invalid JSON: ${error.message}`);
				return;
			}
			setErrorMessage(
				(error as Error).message || "Failed to save roadmap JSON",
			);
		}
	};

	const handleFormatJson = () => {
		if (editorInstance) {
			editorInstance.getAction("editor.action.formatDocument")?.run();
		}
	};

	const handleEditorMount = (editor: Monaco.editor.IStandaloneCodeEditor) => {
		setEditorInstance(editor);
	};

	if (typeof document === "undefined") {
		return null;
	}

	return createPortal(
		<AnimatePresence>
			{isOpen && (
				<>
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.2 }}
						className="fixed inset-0 bg-black/30 z-[1000]"
						onClick={() => {
							if (!isSaving) onClose();
						}}
					/>

					<motion.aside
						initial={{ x: "100%" }}
						animate={{ x: 0 }}
						exit={{ x: "100%" }}
						transition={{ duration: 0.25, ease: "easeInOut" }}
						className="fixed top-0 right-0 h-full w-[min(900px,95vw)] bg-white shadow-2xl z-[1001] flex flex-col"
					>
						<div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
							<div className="flex items-center gap-2">
								<Code2 className="w-5 h-5 text-gray-700" />
								<h2 className="text-base font-semibold text-gray-900">
									JSON Roadmap
								</h2>
							</div>
							<button
								type="button"
								onClick={onClose}
								disabled={isSaving}
								className="p-1.5 rounded-md hover:bg-gray-100 transition-colors disabled:opacity-50"
								aria-label="Close JSON roadmap panel"
							>
								<X className="w-4 h-4" />
							</button>
						</div>

						<div className="flex-1 p-5 overflow-hidden flex flex-col gap-3">
							<div className="flex items-center justify-between gap-3">
								<p className="text-sm text-gray-600">
									Edit the full roadmap JSON and save to apply updates.
								</p>
								<button
									type="button"
									onClick={handleFormatJson}
									className="px-2.5 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
								>
									Format JSON
								</button>
							</div>

							<div className="flex-1 rounded-md border border-gray-300 overflow-hidden">
								<Editor
									height="100%"
									defaultLanguage="json"
									language="json"
									value={jsonValue}
									theme={themeMode === "dark" ? "vs-dark" : "vs"}
									onMount={handleEditorMount}
									onChange={(value) => setJsonValue(value ?? "")}
									options={{
										automaticLayout: true,
										minimap: { enabled: false },
										fontSize: 13,
										lineNumbers: "on",
										tabSize: 2,
										insertSpaces: true,
										wordWrap: "on",
										formatOnPaste: true,
										formatOnType: true,
										scrollBeyondLastLine: false,
										renderLineHighlight: "all",
										bracketPairColorization: { enabled: true },
										suggest: { showWords: false },
									}}
								/>
							</div>

							{errorMessage && (
								<div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
									{errorMessage}
								</div>
							)}
						</div>

						<div className="px-5 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
							<button
								type="button"
								onClick={onClose}
								disabled={isSaving}
								className="px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => void handleSave()}
								disabled={isSaving}
								className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
							>
								{isSaving ? "Saving..." : "Save"}
							</button>
						</div>
					</motion.aside>
				</>
			)}
		</AnimatePresence>,
		document.body,
	);
}
