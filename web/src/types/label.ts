export interface Label {
	id: string;
	name: string;
	color: string;
}

export const LABEL_COLORS = [
	// Row 1 - Pastels
	"#C8E6C9", // Light Green
	"#FFF9C4", // Light Yellow
	"#FFE0B2", // Light Orange
	"#FFCDD2", // Light Pink
	"#E1BEE7", // Light Purple

	// Row 2 - Medium
	"#81C784", // Green
	"#FFF176", // Yellow
	"#FFB74D", // Orange
	"#E57373", // Red
	"#BA68C8", // Purple

	// Row 3 - Dark
	"#388E3C", // Dark Green
	"#F57C00", // Dark Orange
	"#D84315", // Dark Red-Orange
	"#C62828", // Dark Red
	"#7B1FA2", // Dark Purple

	// Row 4 - Blues & Neutrals
	"#BBDEFB", // Light Blue
	"#81D4FA", // Sky Blue
	"#AED581", // Light Lime
	"#F8BBD0", // Light Pink
	"#E0E0E0", // Light Gray

	// Row 5 - Medium Blues
	"#64B5F6", // Blue
	"#4FC3F7", // Cyan
	"#9CCC65", // Lime
	"#F06292", // Pink
	"#9E9E9E", // Gray

	// Row 6 - Dark Blues
	"#1976D2", // Dark Blue
	"#0097A7", // Dark Cyan
	"#689F38", // Dark Lime
	"#C2185B", // Dark Pink
	"#616161", // Dark Gray
];
