/**
 * The Team Owner Agreement: a contract between the OWNER of a team, whatever
 * their role on the platform (client, consultant or talent), and one
 * counterparty. One variant per counterparty:
 *
 *   - talent:     the team engages a contractor to work in it
 *   - consultant: the team engages a consultant to lead or advise its work
 *   - client:     the team provides services to a client
 *
 * Modelled on Prodigitality's Consulting Agreement (the article structure,
 * the confidentiality, rights, non-solicitation and general provisions) and
 * on the per-kind agreements (contracts.client_kind, contracts.document_title).
 * The wording is written once per variant; which SEAT the owner sits in is a
 * separate input, so the same variant renders correctly whether the owner is
 * the hirer or the provider. `{{client}}` is always the hirer seat's block and
 * `{{provider}}` the provider seat's, as in contract-clause-template.ts.
 */

import type { ContractClause } from './contract-clause-template';

export const TEAM_OWNER_TEMPLATE = 'team_owner' as const;
export type TeamOwnerVariant = 'talent' | 'consultant' | 'client';

type Draft = Omit<ContractClause, 'position'>;

const article = (key: string, title: string, body = ''): Draft => ({
  key,
  title,
  body,
});
const section = (
  parent: string,
  key: string,
  title: string,
  body: string,
): Draft => ({ key, parent_key: parent, title, body });

const TITLES: Record<TeamOwnerVariant, string> = {
  talent: 'Team Contractor Agreement',
  consultant: 'Team Consulting Agreement',
  client: 'Team Services Agreement',
};

/** What each variant calls the counterparty in the paper. */
const COUNTERPARTY_TERM: Record<TeamOwnerVariant, string> = {
  talent: 'the Contractor',
  consultant: 'the Consultant',
  client: 'the Client',
};

export function teamOwnerAgreementTitle(variant: TeamOwnerVariant): string {
  return TITLES[variant];
}

/**
 * The positioned clause set for a variant.
 *
 * `ownerSeat` is the seat the team owner holds on this contract. The owner is
 * "the Team" in the text; their party block is `{{client}}` when they are the
 * hirer and `{{provider}}` when they are the provider.
 */
export function teamOwnerAgreementClauses(
  variant: TeamOwnerVariant,
  ownerSeat: 'hirer' | 'provider',
): ContractClause[] {
  const team = ownerSeat === 'hirer' ? '{{client}}' : '{{provider}}';
  const other = ownerSeat === 'hirer' ? '{{provider}}' : '{{client}}';
  const they = COUNTERPARTY_TERM[variant];
  const They = they.charAt(0).toUpperCase() + they.slice(1);
  const drafts =
    variant === 'client'
      ? serviceClauses(team, other)
      : engagementClauses(variant, team, other, they, They);
  return [...drafts, ...sharedClauses(They)].map((clause, index) => ({
    ...clause,
    position: index,
  }));
}

/** talent and consultant: the Team engages the counterparty. */
function engagementClauses(
  variant: 'talent' | 'consultant',
  team: string,
  other: string,
  they: string,
  They: string,
): Draft[] {
  const isConsultant = variant === 'consultant';
  return [
    article(
      'parties',
      'Parties',
      `This ${TITLES[variant]} is made and entered into by and between ${team}, acting as the owner of its team (the "Team"), and ${other} (${they === 'the Contractor' ? 'the "Contractor"' : 'the "Consultant"'}), effective on the service start date set out in the Commercial Terms.`,
    ),
    article('scope_of_work', 'Article 1 — Scope of Work'),
    section(
      'scope_of_work',
      'services',
      '1.1 Services',
      isConsultant
        ? `The Team engages ${they} to lead, advise on or deliver the work described in the Commercial Terms and the services listed in this Agreement, and such related services as the Team may reasonably request.`
        : `The Team engages ${they} to perform the work assigned to them within the Team's projects, as described in the Commercial Terms and the services listed in this Agreement.`,
    ),
    section(
      'scope_of_work',
      'time_and_availability',
      '1.2 Time and Availability',
      `${They} will devote the hours agreed with the Team to the services. ${They} chooses the dates and times of the work, giving due regard to the Team's deadlines and to the time policy in the Commercial Terms.`,
    ),
    section(
      'scope_of_work',
      'team_membership',
      '1.3 Team Membership',
      `While this Agreement is in force ${they} may be given access to the Team's workspace, projects and tools. That access is granted for the purpose of this Agreement only and ends with it.`,
    ),
    section(
      'scope_of_work',
      'standard_of_conduct',
      '1.4 Standard of Conduct',
      `${They} shall conform to high professional standards of work and business ethics, and shall not use the Team's time, materials, accounts or equipment for any purpose other than the services without the Team's prior written consent.`,
    ),
    section(
      'scope_of_work',
      'outside_services',
      '1.5 Outside Services',
      `${They} shall not subcontract any part of the services without the Team's prior written consent, and any person so engaged must first agree in writing to protect the Team's Confidential Information and the Team's ownership of the work.`,
    ),
    section(
      'scope_of_work',
      'reports',
      '1.6 Reports',
      `${They} shall record time and progress in Proyekto as the Commercial Terms require and, on request, give the Team a written account of the work done.`,
    ),
    article('independent_contractor', 'Article 2 — Independent Contractor'),
    section(
      'independent_contractor',
      'contractor_status',
      '2.1 Independent Contractor',
      `${They} is an independent contractor and not an employee, partner or co-venturer of the Team. ${They} controls the manner in which the services are performed and may not speak for or bind the Team without its prior written authorization.`,
    ),
    section(
      'independent_contractor',
      'benefits',
      '2.2 Benefits and Taxes',
      `${They} is not eligible for any employee benefit of the Team and is responsible for their own taxes, insurance and statutory contributions.`,
    ),
    article('compensation', 'Article 3 — Compensation'),
    section(
      'compensation',
      'compensation_rate',
      '3.1 Compensation',
      `The Team shall pay ${they} at the rate and on the schedule set out in the Commercial Terms. Time-based compensation is paid on the hours recorded and approved in Proyekto for the period.`,
    ),
    section(
      'compensation',
      'reimbursement',
      '3.2 Reimbursement',
      `The Team reimburses reasonable expenses directly related to the services that it approved in writing before they were incurred, within 15 days of a proper written request.`,
    ),
    article('term_and_termination', 'Article 4 — Term and Termination'),
    section(
      'term_and_termination',
      'term',
      '4.1 Term',
      'This Agreement runs for the service period in the Commercial Terms and renews only as those terms provide.',
    ),
    section(
      'term_and_termination',
      'termination',
      '4.2 Termination',
      `Either party may end this Agreement by written notice of the period set out in the Commercial Terms. The Team may end it immediately for cause, meaning a material breach not cured within 30 days of notice, fraud, or misappropriation. The Team pays for work performed and approved up to the end date.`,
    ),
    section(
      'term_and_termination',
      'responsibility_upon_termination',
      '4.3 Responsibility upon Termination',
      `On termination ${they} returns any equipment, credentials and materials of the Team, and the Team removes ${they}'s access to its workspace.`,
    ),
  ];
}

/** client: the Team provides services to the Client. */
function serviceClauses(team: string, other: string): Draft[] {
  return [
    article(
      'parties',
      'Parties',
      `This Team Services Agreement is entered into between ${team}, acting as the owner of its team (the "Team"), as the service provider, and ${other} (the "Client"), effective on the service start date set out in the Commercial Terms.`,
    ),
    article('scope_of_work', 'Article 1 — Scope of Services'),
    section(
      'scope_of_work',
      'services',
      '1.1 Services',
      'The Team will provide the services described in the Commercial Terms and the services listed in this Agreement, through its owner and the members of its team.',
    ),
    section(
      'scope_of_work',
      'team_personnel',
      '1.2 Team Personnel',
      'The Team decides which of its members perform the services and remains responsible to the Client for their work as if it were its own.',
    ),
    section(
      'scope_of_work',
      'client_responsibilities',
      '1.3 Client Responsibilities',
      'The Client shall provide timely access, approvals, information and materials the services require. Delays in these may move the timeline.',
    ),
    section(
      'scope_of_work',
      'change_requests',
      '1.4 Change Requests',
      'Work outside the agreed scope is raised as a change request. The Team assesses its effect on cost and timeline before any work begins, and nothing out of scope is included unless approved in writing.',
    ),
    article('independent_contractor', 'Article 2 — Independent Contractor'),
    section(
      'independent_contractor',
      'contractor_status',
      '2.1 Independent Contractor',
      'The Team is an independent contractor. Nothing in this Agreement makes the Team, its owner or its members employees, partners or agents of the Client.',
    ),
    article('compensation', 'Article 3 — Fees and Payment'),
    section(
      'compensation',
      'fees',
      '3.1 Fees',
      'The Client pays the fees in the Commercial Terms, on the billing schedule they set out. Invoices are issued through Proyekto.',
    ),
    section(
      'compensation',
      'late_payment',
      '3.2 Late Payment',
      'The Team may pause work while an invoice is overdue. Third-party costs approved by the Client are billed separately from the professional fee.',
    ),
    article('term_and_termination', 'Article 4 — Term and Termination'),
    section(
      'term_and_termination',
      'term',
      '4.1 Term',
      'This Agreement runs for the service period in the Commercial Terms and renews only as those terms provide.',
    ),
    section(
      'term_and_termination',
      'termination',
      '4.2 Termination',
      'Either party may end this Agreement by written notice of the period set out in the Commercial Terms. The Client pays for work completed and committed costs up to the end date, and the Team hands over completed deliverables once outstanding invoices are settled.',
    ),
  ];
}

/** Articles 5 to 9, common to every variant, from the Consulting Agreement. */
function sharedClauses(They: string): Draft[] {
  return [
    article('confidential_information', 'Article 5 — Confidential Information'),
    section(
      'confidential_information',
      'obligation_of_confidentiality',
      '5.1 Obligation of Confidentiality',
      "Each party keeps the other's Confidential Information private, uses it only to perform this Agreement, and does not disclose it without written consent, during this Agreement and for as long afterwards as the information remains confidential.",
    ),
    section(
      'confidential_information',
      'definition',
      '5.2 Definition',
      '"Confidential Information" means information not generally known that a party treats as confidential, including designs, source code, plans, pricing, client and supplier lists, credentials and internal documents.',
    ),
    article(
      'rights_and_data',
      'Article 6 — Rights and Data',
      `Upon full payment, the deliverables created under this Agreement for the paying party belong to it. Each party keeps its pre-existing materials, templates, methods and reusable tools, and grants the other a licence to use them as far as the deliverables need them.`,
    ),
    article(
      'non_solicitation',
      'Article 7 — Non-Solicitation',
      `During this Agreement and for six months after it, neither party will directly solicit for employment or engagement any member of the other's team with whom it worked under this Agreement, other than through Proyekto with the other party's consent.`,
    ),
    article(
      'injunctive_relief',
      'Article 8 — Right to Injunctive Relief',
      `${They} and the Team acknowledge that a breach of Articles 5, 6 or 7 may cause irreparable harm, and that the harmed party may seek injunctive relief in addition to damages.`,
    ),
    article('general_provisions', 'Article 9 — General Provisions'),
    section(
      'general_provisions',
      'construction_of_terms',
      '9.1 Construction of Terms',
      'If any provision is held unenforceable, it is severed and the rest of this Agreement remains in force.',
    ),
    section(
      'general_provisions',
      'governing_law',
      '9.2 Governing Law',
      'This Agreement is governed by the laws of the Republic of the Philippines, unless the Commercial Terms name another jurisdiction.',
    ),
    section(
      'general_provisions',
      'complete_agreement',
      '9.3 Complete Agreement',
      'This Agreement, with its Commercial Terms and services, is the entire agreement between the parties on its subject and supersedes all prior discussions, written or oral.',
    ),
    section(
      'general_provisions',
      'modification',
      '9.4 Modification',
      'This Agreement is changed only by an amendment signed by both parties in Proyekto.',
    ),
    section(
      'general_provisions',
      'dispute_resolution',
      '9.5 Dispute Resolution',
      'The parties first try in good faith to resolve any dispute between them. A dispute not resolved within 30 days is settled by arbitration, and both parties keep performing their obligations while it is resolved.',
    ),
    section(
      'general_provisions',
      'successors_and_assigns',
      '9.6 Successors and Assigns',
      "Neither party may assign this Agreement without the other's written consent, except that the Team may assign it to a successor that acquires its business.",
    ),
  ];
}

/**
 * Which variant a contract is: named by the COUNTERPARTY's capacity, i.e. the
 * seat the team owner does not hold.
 */
export function teamOwnerVariant(
  counterpartyCapacity: 'client' | 'consultant' | 'talent',
): TeamOwnerVariant {
  return counterpartyCapacity;
}
