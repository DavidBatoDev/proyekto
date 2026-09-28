import { BillingProviderRegistry } from './billing-provider.registry';

function buildRegistry(env: Record<string, string>, stripe: unknown = {}) {
  const config = { get: (key: string) => env[key] };
  return new BillingProviderRegistry(config as never, stripe as never);
}

describe('BillingProviderRegistry', () => {
  it('defaults the active provider to Stripe', () => {
    expect(buildRegistry({}).active()?.id).toBe('stripe');
  });

  it('treats an empty BILLING_PROVIDER as the default', () => {
    expect(buildRegistry({ BILLING_PROVIDER: '  ' }).active()?.id).toBe(
      'stripe',
    );
  });

  it('has no active provider when its credentials are absent — billing is off, not broken', () => {
    const registry = buildRegistry({}, null);
    expect(registry.active()).toBeNull();
    expect(registry.get('stripe')).toBeNull();
  });

  it('has no active provider when the selected one has no adapter configured', () => {
    // Selecting Polar before its adapter exists must not silently keep selling
    // through Stripe.
    expect(buildRegistry({ BILLING_PROVIDER: 'polar' }).active()).toBeNull();
  });

  it('still serves existing Stripe rows after new sales move elsewhere', () => {
    // Switching BILLING_PROVIDER must never strand a paying workspace.
    const registry = buildRegistry({ BILLING_PROVIDER: 'polar' });
    expect(registry.get('stripe')?.id).toBe('stripe');
  });

  it('returns null for a row with no provider or an unknown one', () => {
    const registry = buildRegistry({});
    expect(registry.get(null)).toBeNull();
    expect(registry.get('square')).toBeNull();
  });

  it('fails boot on an unknown BILLING_PROVIDER rather than guessing', () => {
    expect(() => buildRegistry({ BILLING_PROVIDER: 'square' })).toThrow(
      /not a known provider/,
    );
  });
});
