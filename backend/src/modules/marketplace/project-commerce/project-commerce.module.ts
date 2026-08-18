import { Global, Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { PROJECT_COMMERCE_PORT } from '../../execution/projects/ports/project-commerce.port';
import { ProjectCommerceAdapter } from './project-commerce.adapter';

/**
 * Binds marketplace's commerce implementation to the execution-side port.
 *
 * `@Global` on purpose: `ProjectsService` injects the token `@Optional()`, and
 * execution must not import anything from marketplace to obtain it. A global
 * export is what lets the binding reach execution without the arrow pointing
 * the wrong way. Drop this module and execution keeps working on the no-op.
 */
@Global()
@Module({
  imports: [SupabaseModule],
  providers: [
    { provide: PROJECT_COMMERCE_PORT, useClass: ProjectCommerceAdapter },
  ],
  exports: [PROJECT_COMMERCE_PORT],
})
export class ProjectCommerceModule {}
