import {
  applyClientInviteRestrictions,
  getTemplateByKey,
} from './project-permissions';

describe('project-permissions utilities', () => {
  it('forces roadmap.edit and time.view off for client-invited members', () => {
    const base = getTemplateByKey('member');
    base.roadmap.edit = true;
    base.time.view = true;

    const restricted = applyClientInviteRestrictions(base, true);

    expect(restricted.roadmap.edit).toBe(false);
    expect(restricted.time.view).toBe(false);
  });

  it('keeps defaults unchanged when inviter is not client', () => {
    const base = getTemplateByKey('member');

    const result = applyClientInviteRestrictions(base, false);

    expect(result).toEqual(base);
  });
});
