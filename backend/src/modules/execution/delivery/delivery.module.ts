import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { AuthorizationModule } from '../projects/authorization/authorization.module';
import { ChangeRequestsService } from './change-requests.service';
import { DecisionCategoriesService } from './decision-categories.service';
import { DecisionsService } from './decisions.service';
import { DeliverablesService } from './deliverables.service';
import {
  ChangeRequestsController,
  DecisionCategoriesController,
  DecisionsController,
  DeliverablesController,
  RisksController,
} from './delivery.controller';
import { RisksService } from './risks.service';

/**
 * Delivery governance: Deliverables, Change Requests, Risks & Issues, and
 * Decisions.
 *
 * One module rather than four because they share a single `access.delivery`
 * gate, link to each other, and are always granted and revoked together.
 *
 * Imports AuthorizationModule rather than ProjectsModule for the same reason
 * ActivityModule does: assertPermission is the whole dependency, and going via
 * ProjectsService would add a lookup and turn a non-member's 403 into a 404.
 *
 * AuditService arrives from the @Global AuditModule, so it needs no import.
 *
 * NotificationsModule is imported for the change-request fan-out: a submitted
 * request has to reach whoever can decide it, or the workflow dead-ends in a
 * list nobody is watching.
 */
@Module({
  imports: [SupabaseModule, AuthorizationModule, NotificationsModule],
  controllers: [
    DeliverablesController,
    ChangeRequestsController,
    RisksController,
    DecisionsController,
    DecisionCategoriesController,
  ],
  providers: [
    DeliverablesService,
    ChangeRequestsService,
    RisksService,
    DecisionsService,
    DecisionCategoriesService,
  ],
  // The MCP module reuses these in-process so its tools inherit the same
  // assertPermission gates the REST controllers get.
  exports: [
    DeliverablesService,
    ChangeRequestsService,
    RisksService,
    DecisionsService,
    DecisionCategoriesService,
  ],
})
export class DeliveryModule {}
