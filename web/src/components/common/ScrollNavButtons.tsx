import { useState, useEffect, useCallback } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

export function ScrollNavButtons() {
  const [showUp, setShowUp] = useState(false);
  const [showDown, setShowDown] = useState(false);

  const update = useCallback(() => {
    const scrollY = window.scrollY;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
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
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-1.5">
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        style={{ visibility: showUp ? "visible" : "hidden" }}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white shadow-md transition-all hover:bg-slate-700 active:scale-95"
        aria-label="Scroll to top"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        onClick={() =>
          window.scrollTo({
            top: document.documentElement.scrollHeight,
            behavior: "smooth",
          })
        }
        style={{ visibility: showDown ? "visible" : "hidden" }}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white shadow-md transition-all hover:bg-slate-700 active:scale-95"
        aria-label="Scroll to bottom"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
    </div>
  );
}
