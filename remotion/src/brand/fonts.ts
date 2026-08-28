/**
 * Proyekto's two brand faces, matching what `web/src/styles.css` loads.
 *
 * Sora is the app's heading face (`font-family: "Sora", "Manrope", sans-serif`
 * at styles.css:198); Manrope is the body face. Both are pulled in by the
 * Google Fonts `@import` on styles.css line 1, so using them here keeps the
 * videos typographically identical to the page they sit on.
 *
 * `loadFont()` runs at MODULE SCOPE deliberately: it registers a
 * `delayRender()` handle, so the renderer blocks until the font is ready.
 * Called lazily inside a component instead, some frames would render in a
 * fallback face — and which fallback would depend on the render machine.
 */
import { loadFont as loadManrope } from "@remotion/google-fonts/Manrope";
import { loadFont as loadSora } from "@remotion/google-fonts/Sora";

const sora = loadSora("normal", { weights: ["600", "700"], subsets: ["latin"] });
const manrope = loadManrope("normal", {
	weights: ["500", "600", "700"],
	subsets: ["latin"],
});

/** Display face — caption lines. */
export const FONT_DISPLAY = sora.fontFamily;
/** UI face — eyebrows, chips, labels. */
export const FONT_BODY = manrope.fontFamily;
