import { Harness } from './harness';
import { ProjectCommerceAdapter } from '../../src/modules/marketplace/project-commerce/project-commerce.adapter';
import {
  NoopProjectCommerce,
  PROJECT_COMMERCE_PORT,
  type ProjectCommercePort,
} from '../../src/modules/execution/projects/ports/project-commerce.port';
import { ProjectsService } from '../../src/modules/execution/projects/projects.service';

/**
 * Guards the one failure mode the unit tests cannot see.
 *
 * ProjectsService injects the commerce port `@Optional()`, so if the binding in
 * ProjectCommerceModule ever stops reaching it — a lost `@Global`, a module
 * dropped from AppModule, a token mismatch — the app still boots perfectly and
 * silently falls back to the no-op. That no-op never forbids anything, so
 * project deletion would quietly stop being blocked by live contracts and
 * issued invoices, and the dashboard would report zero invoices forever.
 *
 * Nothing else would fail. Hence this.
 */
describe('project commerce wiring (real AppModule)', () => {
  const h = new Harness();

  beforeAll(async () => {
    await h.boot();
  }, 120000);

  afterAll(async () => {
    await h.close();
  }, 120000);

  it('binds the marketplace adapter, not the standalone no-op', () => {
    const port = h.app.get<ProjectCommercePort>(PROJECT_COMMERCE_PORT);

    expect(port).toBeInstanceOf(ProjectCommerceAdapter);
    expect(port).not.toBeInstanceOf(NoopProjectCommerce);
  });

  it('injects that same adapter into ProjectsService', () => {
    const service = h.app.get(ProjectsService);
    // The field is private; reading it is the only way to prove the wiring
    // actually reached the consumer rather than merely existing in the container.
    const injected = (service as unknown as { commerce: ProjectCommercePort })
      .commerce;

    expect(injected).toBeInstanceOf(ProjectCommerceAdapter);
  });
});
