import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../config/supabase.module';
import { DeviceTokensController } from './device-tokens.controller';
import { DeviceTokensService } from './device-tokens.service';
import { PushService } from './push.service';

/**
 * Owns FCM push: the device_tokens registry (controller + service) and the
 * firebase-admin sender. Exports PushService so NotificationsService can fan a
 * push out whenever an in-app notification is created.
 */
@Module({
  imports: [SupabaseModule],
  controllers: [DeviceTokensController],
  providers: [DeviceTokensService, PushService],
  exports: [PushService],
})
export class PushModule {}
