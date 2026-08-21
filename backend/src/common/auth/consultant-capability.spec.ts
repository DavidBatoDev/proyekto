import {
  attachMarketplaceEnrollmentFields,
  consultantFlagFromEmbed,
  consultantStatusFromEmbed,
} from './consultant-capability';

describe('consultant enrollment embeds', () => {
  it.each([
    { value: { status: 'verified' }, expected: true },
    { value: [{ status: 'verified' }], expected: true },
    { value: { status: 'suspended' }, expected: false },
    { value: [], expected: false },
    { value: null, expected: false },
  ])(
    'normalizes PostgREST relationship shape: $value',
    ({ value, expected }) => {
      expect(consultantFlagFromEmbed(value)).toBe(expected);
    },
  );

  it('returns null for absent or unknown consultant states', () => {
    expect(consultantStatusFromEmbed(null)).toBeNull();
    expect(consultantStatusFromEmbed({ status: 'unknown' })).toBeNull();
  });

  it('synthesizes OTA flags and removes raw relationship containers', () => {
    const profile = attachMarketplaceEnrollmentFields({
      id: 'user-1',
      consultant_profile: [{ status: 'verified' }],
      talent_profile: { status: 'paused' },
    });

    expect(profile).toMatchObject({
      id: 'user-1',
      consultant_status: 'verified',
      talent_status: 'paused',
      is_consultant_verified: true,
      is_public: false,
    });
    expect(profile).not.toHaveProperty('consultant_profile');
    expect(profile).not.toHaveProperty('talent_profile');
  });
});
