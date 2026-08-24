import { buildProjectTeamInviteEmail } from './project-team-invite-email.template';

/**
 * Byte-for-byte guard on the "invite a team to a project" body, plus the
 * escaping — every field here is caller-supplied and must come out inert.
 *
 * If a snapshot moves, the shared layout changed. Read the diff rather than
 * re-recording: this template and the team invitation are meant to look like
 * the same product, and a change landing in one and not the other is how they
 * drift apart.
 */
describe('buildProjectTeamInviteEmail', () => {
  const base = {
    inviterName: 'Ada Lovelace',
    projectName: 'Difference Engine v2',
    inviteLink:
      'https://app.proyekto.test/teams/me/invites?inviteId=6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
  };

  it('renders a full invitation', () => {
    const body = buildProjectTeamInviteEmail({
      ...base,
      teamNameHint: 'Analytical Engines Ltd',
      memberRole: 'editor',
      makePrimary: true,
      inviteMessage: 'Would love your crew on the punch-card pipeline.',
    });

    expect(body.subject).toMatchSnapshot('subject');
    expect(body.html).toMatchSnapshot('html');
    expect(body.text).toMatchSnapshot('text');
  });

  it('renders a minimal invitation (no team hint, role or message)', () => {
    const body = buildProjectTeamInviteEmail(base);

    expect(body.subject).toMatchSnapshot('subject');
    expect(body.html).toMatchSnapshot('html');
    expect(body.text).toMatchSnapshot('text');
  });

  it('omits the team row when the inviter named no team', () => {
    // An empty "Team" row reads as "we could not find your team", which is a
    // different and alarming message from "they did not say".
    const body = buildProjectTeamInviteEmail(base);

    expect(body.html).not.toContain('>Team<');
    expect(body.text).not.toContain('Team:');
  });

  it('says the decision is still the recipient’s', () => {
    // The whole point of this invitation is consent: nobody on the invitee's
    // team gets project access until they accept. If this line ever goes
    // missing, the email starts reading like a notification of a done deal.
    const body = buildProjectTeamInviteEmail(base);

    expect(body.html).toContain('Nobody on your team gets access until you do');
    expect(body.text).toContain('Nobody on your team gets access until you do');
  });

  it('mentions the primary-team consequence only when it is being asked for', () => {
    const asked = buildProjectTeamInviteEmail({ ...base, makePrimary: true });
    const notAsked = buildProjectTeamInviteEmail({
      ...base,
      makePrimary: false,
    });

    expect(asked.html).toContain('primary team');
    expect(asked.text).toContain('primary team');
    expect(notAsked.html).not.toContain('primary team');
    expect(notAsked.text).not.toContain('primary team');
  });

  it('keeps the signup promise the reconciler is what makes true', () => {
    // handle_profile_project_team_invites_reconciliation backfills invitee_id
    // by email on profile insert. Without that trigger this sentence would be
    // a lie, because listForMe filters on invitee_id only.
    const body = buildProjectTeamInviteEmail(base);

    expect(body.html).toContain('sign up with this email address');
    expect(body.text).toContain('sign up with this email address');
  });

  it('escapes markup in every caller-supplied field', () => {
    const body = buildProjectTeamInviteEmail({
      inviterName: '<script>alert(1)</script>',
      projectName: '<img src=x onerror=alert(2)>',
      inviteLink: 'https://app.proyekto.test/teams/me/invites',
      teamNameHint: '"><b>Engines</b>',
      memberRole: '"><b>admin</b>',
      inviteMessage: '<iframe src="evil"></iframe>',
    });

    // The property is that no LIVE markup survives; the payload text may still
    // appear in escaped form, so asserting on `onerror=` alone would fail for
    // the wrong reason.
    expect(body.html).not.toContain('<script>');
    expect(body.html).not.toContain('<img src=x');
    expect(body.html).not.toContain('<iframe');
    expect(body.html).toContain('&lt;script&gt;');
    expect(body.html).toContain('&lt;img src=x');
    expect(body.html).toMatchSnapshot('html');
  });
});
