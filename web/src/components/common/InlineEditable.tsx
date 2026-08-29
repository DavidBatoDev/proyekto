import { type TextareaHTMLAttributes, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A textarea that is exactly as tall as its content.
 *
 * For edit-in-place surfaces, where a field has to look like the text it will
 * become: a fixed `rows` leaves phantom empty lines under a one-line title, and
 * a scrollbar inside a heading reads as a bug. The height is measured after
 * every value change and on resize, since wrapping depends on the width.
 */
export function AutoTextarea({
	value,
	className,
	...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
	const ref = useRef<HTMLTextAreaElement>(null);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const fit = () => {
			el.style.height = "auto";
			el.style.height = `${el.scrollHeight}px`;
		};
		fit();
		window.addEventListener("resize", fit);
		return () => window.removeEventListener("resize", fit);
	}, [value]);

	return (
		<textarea
			ref={ref}
			value={value}
			rows={1}
			className={cn("overflow-hidden", className)}
			{...rest}
		/>
	);
}
