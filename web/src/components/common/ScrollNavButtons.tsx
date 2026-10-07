import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * Floating scroll-to-top / scroll-to-bottom pair, pinned to the bottom-left of
 * the content column.
 *
 * Both buttons always occupy their slot — an unavailable direction is hidden
 * with `visibility`, never unmounted — so the remaining button never jumps to
 * where the other one was as you scroll. Bottom-left keeps them off the
 * page's primary action, which sits bottom-right on most surfaces.
 */
export function ScrollNavButtons() {
	const [showUp, setShowUp] = useState(false);
	const [showDown, setShowDown] = useState(false);

	const update = useCallback(() => {
		const scrollY = window.scrollY;
		const maxScroll =
			document.documentElement.scrollHeight - window.innerHeight;
		setShowUp(scrollY > 40);
		setShowDown(maxScroll > 40 && scrollY < maxScroll - 40);
	}, []);

	useEffect(() => {
		update();
		window.addEventListener("scroll", update, { passive: true });
		window.addEventListener("resize", update, { passive: true });
		return () => {
			window.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
		};
	}, [update]);

	if (!showUp && !showDown) return null;

	return (
		// bottom-24 clears the mobile tab bar (h-app-nav, < 768px); at lg the
		// 260px sidebar is in flow, so the left offset steps past it.
		<div className="fixed bottom-24 left-4 z-40 flex flex-col gap-2 md:bottom-6 md:left-6 lg:left-[17.75rem]">
			<ScrollButton
				visible={showUp}
				label="Scroll to top"
				onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
			>
				<ChevronUp className="h-5 w-5" />
			</ScrollButton>
			<ScrollButton
				visible={showDown}
				label="Scroll to bottom"
				onClick={() =>
					window.scrollTo({
						top: document.documentElement.scrollHeight,
						behavior: "smooth",
					})
				}
			>
				<ChevronDown className="h-5 w-5" />
			</ScrollButton>
		</div>
	);
}

function ScrollButton({
	visible,
	label,
	onClick,
	children,
}: {
	visible: boolean;
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			aria-hidden={!visible}
			tabIndex={visible ? 0 : -1}
			style={{ visibility: visible ? "visible" : "hidden" }}
			className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-150 hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/30 active:scale-95"
		>
			{children}
		</button>
	);
}
