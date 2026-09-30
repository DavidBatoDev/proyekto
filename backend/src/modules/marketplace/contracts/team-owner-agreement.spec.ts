import { renderClauseBody } from './contract-clause-template';
import {
  teamOwnerAgreementClauses,
  teamOwnerAgreementTitle,
  type TeamOwnerVariant,
} from './team-owner-agreement';

const VARIANTS: TeamOwnerVariant[] = ['talent', 'consultant', 'client'];

describe('Team Owner Agreement', () => {
  it.each(VARIANTS)(
    '%s: positioned, unique keys, parents that exist',
    (variant) => {
      const clauses = teamOwnerAgreementClauses(variant, 'hirer');
      expect(clauses.map((c) => c.position)).toEqual(clauses.map((_, i) => i));
      const keys = clauses.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const clause of clauses) {
        if (clause.parent_key) expect(keys).toContain(clause.parent_key);
      }
      // Modelled on the Consulting Agreement: the shared articles are there.
      expect(keys).toEqual(
        expect.arrayContaining([
          'confidential_information',
          'rights_and_data',
          'non_solicitation',
          'general_provisions',
        ]),
      );
    },
  );

  it('names each variant by its counterparty', () => {
    expect(teamOwnerAgreementTitle('talent')).toBe('Team Contractor Agreement');
    expect(teamOwnerAgreementTitle('consultant')).toBe(
      'Team Consulting Agreement',
    );
    expect(teamOwnerAgreementTitle('client')).toBe('Team Services Agreement');
  });

  it('puts the team owner on whichever seat they hold', () => {
    const parties = {
      client: 'Hirer Co',
      provider: 'Provider Co',
    };
    const asHirer = teamOwnerAgreementClauses('consultant', 'hirer')[0];
    const asProvider = teamOwnerAgreementClauses('client', 'provider')[0];

    expect(renderClauseBody(asHirer.body, parties)).toMatch(
      /^This Team Consulting Agreement is made and entered into by and between Hirer Co, acting as the owner of its team \(the "Team"\), and Provider Co/,
    );
    expect(renderClauseBody(asProvider.body, parties)).toMatch(
      /between Provider Co, acting as the owner of its team \(the "Team"\), as the service provider, and Hirer Co \(the "Client"\)/,
    );
  });

  it('calls a talent counterparty the Contractor', () => {
    const body = teamOwnerAgreementClauses('talent', 'hirer')
      .map((c) => c.body)
      .join(' ');
    expect(body).toContain('the "Contractor"');
    expect(body).not.toContain('the "Client"');
  });
});
