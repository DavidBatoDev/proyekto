/**
 * ProfileModal — lightweight modal shell used across all profile edit modals
 */

import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

interface ProfileModalProps {
	isOpen: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	width?: "sm" | "md" | "lg";
}

export function ProfileModal({
	isOpen,
	onClose,
	title,
	children,
	width = "md",
}: ProfileModalProps) {
	// Close on Escape
	useEffect(() => {
		if (!isOpen) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [isOpen, onClose]);

	if (!isOpen) return null;

	const widthClass = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" }[width];

	const modalContent = (
		<div
			className="fixed inset-0 z-9999 flex items-center justify-center p-4"
			aria-modal="true"
			role="dialog"
		>
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
				onClick={onClose}
			/>

			{/* Panel */}
			<div
				className={`relative w-full ${widthClass} bg-white rounded-2xl shadow-2xl max-h-[90vh] flex flex-col`}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
					<h3 className="text-base font-semibold text-gray-900">{title}</h3>
					<button
						onClick={onClose}
						className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				{/* Content */}
				<div className="overflow-y-auto px-6 py-5 flex-1">{children}</div>
			</div>
		</div>
	);

	// Use createPortal to escape any stacking contexts created by parent DOM elements (e.g. Framer Motion)
	return createPortal(modalContent, document.body);
}
