import { buildTeamInviteEmail } from './team-invite-email.template';

/**
 * Byte-for-byte guard on the team invitation body, plus the escaping — every
 * field here is caller-supplied and must come out inert.
 *
 * If a snapshot moves, the shared layout changed. That is worth reading rather
 * than re-recording: this template and the project invitation are supposed to
 * be visually identical, and a diff in one and not the other means they have
 * started to drift again.
 */
describe('buildTeamInviteEmail', () => {
  const base = {
    inviterName: 'Ada Lovelace',
    teamName: 'Analytical Engines Ltd',
    inviteLink:
      'https://app.proyekto.test/teams/me/invites?inviteId=6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
  };

  it('renders a full invitation', () => {
    const body = buildTeamInviteEmail({
      ...base,
      role: 'admin',
      position: 'Lead Engineer',
      inviteMessage: 'Would love your help on the punch-card pipeline.',
    });

    expect(body.subject).toMatchSnapshot('subject');
    expect(body.html).toMatchSnapshot('html');
    expect(body.text).toMatchSnapshot('text');
  });

  it('renders a minimal invitation (no role, position or message)', () => {
    const body = buildTeamInviteEmail(base);

    expect(body.subject).toMatchSnapshot('subject');
    expect(body.html).toMatchSnapshot('html');
    expect(body.text).toMatchSnapshot('text');
  });

  it('omits the role row when it is the default', () => {
    // "Role: member" tells the reader nothing they did not assume.
    const withDefault = buildTeamInviteEmail({ ...base, role: 'member' });
    const withElevated = buildTeamInviteEmail({ ...base, role: 'admin' });

    expect(withDefault.html).not.toContain('Role');
    expect(withDefault.text).not.toContain('Role:');
    expect(withElevated.html).toContain('Role');
  });

  it('keeps the signup promise the reconciler is what makes true', () => {
    // handle_profile_team_invites_reconciliation backfills invitee_id by email
    // on profile insert. Without that trigger this sentence would be a lie,
    // because listInvitesForMe filters on invitee_id only.
    const body = buildTeamInviteEmail(base);

    expect(body.html).toContain('sign up with this email address');
    expect(body.text).toContain('sign up with this email address');
  });

  it('escapes markup in every caller-supplied field', () => {
    const body = buildTeamInviteEmail({
      inviterName: '<script>alert(1)</script>',
      teamName: '<img src=x onerror=alert(2)>',
      inviteLink: 'https://app.proyekto.test/teams/me/invites',
      role: '"><b>admin</b>',
      position: '"><b>bold</b>',
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
