/**
 * Loading Screen Component
 * Displays while authentication is initializing
 */

import { Box, CircularProgress } from "@mui/material";

export function LoadingScreen() {
	return (
		<Box
			sx={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				minHeight: "100vh",
				backgroundColor: "white",
			}}
		>
			{/* Loading Spinner */}
			<CircularProgress
				size={50}
				sx={{
					color: "var(--primary)",
				}}
			/>
		</Box>
	);
}
