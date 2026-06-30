import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../config/supabase.module';
import { MobileUpdatesController } from './mobile-updates.controller';
import { MobileUpdatesService } from './mobile-updates.service';
import { OtaPublishGuard } from './guards/ota-publish.guard';

/**
 * Self-hosted OTA update server for @capgo/capacitor-updater. Exposes the Capgo
 * check/stats endpoints plus secret-gated publish endpoints, backed by R2
 * (bundle storage, @Global R2Module) and Supabase (the mobile_app_bundles
 * registry).
 */
@Module({
  imports: [SupabaseModule],
  controllers: [MobileUpdatesController],
  providers: [MobileUpdatesService, OtaPublishGuard],
})
export class MobileUpdatesModule {}
