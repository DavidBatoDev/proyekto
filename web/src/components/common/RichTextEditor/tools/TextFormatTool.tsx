import { ChevronDown, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface TextFormatToolProps {
	onCommand: (command: string, value?: string) => void;
}

const formats = [
	{ label: "Paragraph", value: "p", tag: "P" },
	{ label: "Heading 1", value: "h1", tag: "H1" },
	{ label: "Heading 2", value: "h2", tag: "H2" },
	{ label: "Heading 3", value: "h3", tag: "H3" },
	{ label: "Heading 4", value: "h4", tag: "H4" },
	{ label: "Heading 5", value: "h5", tag: "H5" },
	{ label: "Heading 6", value: "h6", tag: "H6" },
];

export function TextFormatTool({ onCommand }: TextFormatToolProps) {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(event.target as Node)
			) {
				setIsOpen(false);
			}
		}

		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	const handleSelect = (format: (typeof formats)[0]) => {
		onCommand("formatBlock", format.value);
		setIsOpen(false);
	};

	return (
		<div className="relative" ref={dropdownRef}>
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors"
				title="Text format"
			>
				<Type className="w-4 h-4" />
				<ChevronDown className="w-3 h-3" />
			</button>

			{isOpen && (
				<div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
					{formats.map((format) => (
						<button
							key={format.value}
							type="button"
							onClick={() => handleSelect(format)}
							className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 transition-colors"
						>
							{format.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
