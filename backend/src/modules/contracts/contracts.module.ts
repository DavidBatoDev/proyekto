import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthorizationModule } from '../projects/authorization/authorization.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ProjectActivationController } from './project-activation.controller';
import { ProjectActivationService } from './project-activation.service';

/**
 * Depends on AuthorizationModule rather than the whole ProjectsModule, so
 * ProjectsModule can import THIS module (for the activation gate) without a
 * circular dependency.
 */
@Module({
  imports: [AuthorizationModule, NotificationsModule],
  controllers: [ContractsController, ProjectActivationController],
  providers: [ContractsService, ProjectActivationService],
  exports: [ContractsService, ProjectActivationService],
})
export class ContractsModule {}
