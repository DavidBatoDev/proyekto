import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
	FINANCE_CRUMB_LINK_CLASS,
	FinanceBreadcrumbs,
	FinanceCurrentCrumb,
} from "@/components/finance/portfolio/FinanceBreadcrumbs";

/**
 * The one breadcrumb for every finance page, built from the same tree the
 * sidebar draws (see `engagementsNavigation.ts`):
 *
 *   Engagements › My finance › My teams › <team> › <project> › <page>
 *
 * Pass as much of the chain as the page sits under; the deepest level given
 * without a `current` label is rendered as the current page. A team always
 * links to its team page — never to a book — so "up" from a project is the
 * team you came from.
 */
export function FinanceTrail({
	team,
	project,
	shared,
	current,
}: {
	team?: { id: string; name: string };
	project?: { bookId: string; title: string };
	/** The page sits under "Shared with me" instead of "My teams". */
	shared?: boolean;
	/** The page's own label, when it is deeper than the last node above. */
	current?: ReactNode;
}) {
	const items: ReactNode[] = [
		<Link
			key="engagements"
			to="/engagements"
			className={FINANCE_CRUMB_LINK_CLASS}
		>
			Engagements
		</Link>,
	];

	const atRoot = !team && !project && !shared;
	items.push(
		atRoot && !current ? (
			<FinanceCurrentCrumb key="finance">My finance</FinanceCurrentCrumb>
		) : (
			<Link
				key="finance"
				to="/engagements/finance"
				className={FINANCE_CRUMB_LINK_CLASS}
			>
				My finance
			</Link>
		),
	);

	if (shared) {
		items.push(
			!team && !project && !current ? (
				<FinanceCurrentCrumb key="shared">Shared with me</FinanceCurrentCrumb>
			) : (
				<Link
					key="shared"
					to="/engagements/finance/shared"
					className={FINANCE_CRUMB_LINK_CLASS}
				>
					Shared with me
				</Link>
			),
		);
	} else if (team) {
		items.push(
			<Link
				key="teams"
				to="/engagements/finance/teams"
				className={FINANCE_CRUMB_LINK_CLASS}
			>
				My teams
			</Link>,
		);
	}

	if (team) {
		items.push(
			!project && !current ? (
				<FinanceCurrentCrumb key="team">{team.name}</FinanceCurrentCrumb>
			) : (
				<Link
					key="team"
					to="/engagements/finance/team/$teamId"
					params={{ teamId: team.id }}
					className={FINANCE_CRUMB_LINK_CLASS}
				>
					{team.name}
				</Link>
			),
		);
	}

	if (project && team) {
		items.push(
			!current ? (
				<FinanceCurrentCrumb key="project">{project.title}</FinanceCurrentCrumb>
			) : (
				<Link
					key="project"
					to="/engagements/finance/team/$teamId/project/$bookId"
					params={{ teamId: team.id, bookId: project.bookId }}
					className={FINANCE_CRUMB_LINK_CLASS}
				>
					{project.title}
				</Link>
			),
		);
	}

	if (current) {
		items.push(
			<FinanceCurrentCrumb key="current">{current}</FinanceCurrentCrumb>,
		);
	}

	return <FinanceBreadcrumbs items={items} />;
}
