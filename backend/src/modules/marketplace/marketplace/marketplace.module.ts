import { Module } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { AuthorizationModule } from '../../execution/projects/authorization/authorization.module';
import { ProfileModule } from '../profile/profile.module';

@Module({
  imports: [NotificationsModule, AuthorizationModule, ProfileModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
})
export class MarketplaceModule {}
