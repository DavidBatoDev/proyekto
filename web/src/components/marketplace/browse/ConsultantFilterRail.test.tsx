/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsultantDirectoryFacets } from "@/queries/consultants";
import { ConsultantFilterRail } from "./ConsultantFilterRail";

const useMarketplaceCategoryNavigationQuery = vi.fn();

vi.mock("@/hooks/useMarketplaceTaxonomy", () => ({
	useMarketplaceCategoryNavigationQuery: () =>
		useMarketplaceCategoryNavigationQuery(),
}));

const CATEGORIES = Array.from({ length: 9 }, (_, index) => ({
	id: `cat-${index}`,
	slug: `category-${index}`,
	name: `Category ${index}`,
	description: null,
	icon: null,
	position: index,
	subcategories:
		index === 0
			? [
					{
						id: "sub-1",
						slug: "speciality-one",
						name: "Speciality One",
						description: null,
						position: 0,
					},
				]
			: [],
}));

const FACETS: ConsultantDirectoryFacets = {
	categories: [{ slug: "category-1", count: 4 }],
	subcategories: [
		{ categorySlug: "category-0", slug: "speciality-one", count: 2 },
	],
	countries: [],
	languages: [],
	priceRange: null,
	total: 4,
};

afterEach(() => {
	vi.clearAllMocks();
	cleanup();
});

const renderRail = (search = {}, facets?: ConsultantDirectoryFacets) => {
	const onChange = vi.fn();
	render(
		<ConsultantFilterRail
			search={search}
			facets={facets}
			onChange={onChange}
			onClear={vi.fn()}
		/>,
	);
	return { onChange };
};

describe("ConsultantFilterRail", () => {
	// The taxonomy is the rail's only data dependency; every test needs it.
	beforeEach(() => {
		useMarketplaceCategoryNavigationQuery.mockReturnValue({
			data: CATEGORIES,
			isPending: false,
		});
	});

	it("collapses a long list behind a count and expands it in place", () => {
		renderRail();

		// 10 options (All categories + 9), 5 shown.
		expect(screen.queryByText("Category 7")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "+5 more" }));

		expect(screen.getByText("Category 7")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Show less" }));
		expect(screen.queryByText("Category 7")).toBeNull();
	});

	// Hiding the active filter is how a list ends up showing results nobody can
	// explain, so the selection is pinned into the collapsed view.
	it("keeps a selected option visible even when it sits past the fold", () => {
		renderRail({ category: "category-7" });

		expect(screen.getByText("Category 7")).toBeTruthy();
	});

	it("renders facet counts beside the options that have them", () => {
		renderRail({}, FACETS);

		expect(screen.getByText("(4)")).toBeTruthy();
	});

	it("shows specialities only once a category is chosen", () => {
		renderRail();
		expect(screen.queryByText(/specialities/i)).toBeNull();

		cleanup();
		renderRail({ category: "category-0" });
		expect(screen.getByText("Category 0 specialities")).toBeTruthy();
	});

	it("clears the speciality when the category changes", () => {
		const { onChange } = renderRail({
			category: "category-0",
			subcategory: "speciality-one",
		});

		fireEvent.click(screen.getByText("Category 1"));

		expect(onChange).toHaveBeenCalledWith({
			category: "category-1",
			subcategory: undefined,
		});
	});
});
