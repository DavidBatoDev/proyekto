declare module "@mui/icons-material/*" {
	import * as React from "react";
	const Component: React.ComponentType<
		React.SVGProps<SVGSVGElement> & {
			fontSize?: "inherit" | "large" | "medium" | "small";
		}
	>;
	export default Component;
}
