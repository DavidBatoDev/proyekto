import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { ChangeRequestsService } from './change-requests.service';
import { DecisionCategoriesService } from './decision-categories.service';
import { DecisionsService } from './decisions.service';
import { DeliverablesService } from './deliverables.service';
import {
  AddDeliverableAttachmentDto,
  AddDeliverableReviewerDto,
  CreateChangeRequestDto,
  CreateDecisionCategoryDto,
  CreateDeliverableCriterionDto,
  UpdateDeliverableCriterionDto,
  CreateDecisionDto,
  CreateDeliverableDto,
  CreateRiskDto,
  DecideChangeRequestDto,
  DecisionOptionInputDto,
  ListChangeRequestsQueryDto,
  ListDecisionsDto,
  ListDeliverablesQueryDto,
  ListRisksQueryDto,
  LinkTargetDto,
  MarkChangeRequestAppliedDto,
  ReviewDeliverableDto,
  UpdateChangeRequestDto,
  UpdateDecisionCategoryDto,
  UpdateDecisionDto,
  UpdateDecisionOptionDto,
  UpdateDeliverableDto,
  UpdateRiskDto,
} from './dto/delivery.dto';
import { RisksService } from './risks.service';

// Every route is gated in its service via ProjectAuthorizationService, which
// resolves role ⊕ origin ⊕ capabilities — a check that cannot be expressed as
// an RLS predicate, which is why these tables are service-role-write only.
// ResponseInterceptor supplies the envelope; return raw data here.

@UseGuards(SupabaseAuthGuard)
@Controller('projects/:projectId/deliverables')
export class DeliverablesController {
  constructor(private readonly deliverables: DeliverablesService) {}

  @Get()
  list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDeliverablesQueryDto,
  ) {
    return this.deliverables.list(projectId, user.id, query);
  }

  @Get(':id')
  get(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deliverables.get(projectId, id, user.id);
  }

  @Post()
  create(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDeliverableDto,
  ) {
    return this.deliverables.create(projectId, user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateDeliverableDto,
  ) {
    return this.deliverables.update(projectId, id, user.id, dto);
  }

  /** Hand it to the reviewer. Separate from PATCH so the stamps can't be skipped. */
  @Post(':id/submit')
  submit(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deliverables.submit(projectId, id, user.id);
  }

  @Post(':id/review')
  review(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewDeliverableDto,
  ) {
    return this.deliverables.review(projectId, id, user.id, dto);
  }

  @Post(':id/links')
  addLink(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LinkTargetDto,
  ) {
    return this.deliverables.addLink(
      projectId,
      id,
      user.id,
      dto as Record<string, string>,
    );
  }

  @Delete(':id/links/:linkId')
  removeLink(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deliverables.removeLink(projectId, id, linkId, user.id);
  }

  @Post(':id/attachments')
  addAttachment(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddDeliverableAttachmentDto,
  ) {
    return this.deliverables.addAttachment(projectId, id, user.id, dto);
  }

  @Delete(':id/attachments/:attachmentId')
  removeAttachment(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deliverables.removeAttachment(
      projectId,
      id,
      attachmentId,
      user.id,
    );
  }

  // ── Acceptance criteria ───────────────────────────────────────────────────

  @Post(':id/criteria')
  addCriterion(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDeliverableCriterionDto,
  ) {
    return this.deliverables.addCriterion(projectId, id, user.id, dto);
  }

  @Patch(':id/criteria/:criterionId')
  updateCriterion(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Param('criterionId') criterionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateDeliverableCriterionDto,
  ) {
    return this.deliverables.updateCriterion(
      projectId,
      id,
      criterionId,
      user.id,
      dto,
    );
  }

  @Delete(':id/criteria/:criterionId')
  removeCriterion(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Param('criterionId') criterionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deliverables.removeCriterion(
      projectId,
      id,
      criterionId,
      user.id,
    );
  }

  // ── Reviewers ─────────────────────────────────────────────────────────────

  @Post(':id/reviewers')
  addReviewer(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddDeliverableReviewerDto,
  ) {
    return this.deliverables.addReviewer(projectId, id, user.id, dto);
  }

  @Delete(':id/reviewers/:reviewerId')
  removeReviewer(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Param('reviewerId') reviewerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deliverables.removeReviewer(projectId, id, reviewerId, user.id);
  }

  @Delete(':id')
  remove(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deliverables.remove(projectId, id, user.id);
  }
}

@UseGuards(SupabaseAuthGuard)
@Controller('projects/:projectId/change-requests')
export class ChangeRequestsController {
  constructor(private readonly changeRequests: ChangeRequestsService) {}

  @Get()
  list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListChangeRequestsQueryDto,
  ) {
    return this.changeRequests.list(projectId, user.id, query);
  }

  @Get(':id')
  get(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.changeRequests.get(projectId, id, user.id);
  }

  @Post()
  create(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateChangeRequestDto,
  ) {
    return this.changeRequests.create(projectId, user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateChangeRequestDto,
  ) {
    return this.changeRequests.update(projectId, id, user.id, dto);
  }

  @Post(':id/submit')
  submit(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.changeRequests.submit(projectId, id, user.id);
  }

  @Post(':id/withdraw')
  withdraw(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.changeRequests.withdraw(projectId, id, user.id);
  }

  @Post(':id/decision')
  decide(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DecideChangeRequestDto,
  ) {
    return this.changeRequests.decide(projectId, id, user.id, dto);
  }

  @Post(':id/links')
  addLink(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LinkTargetDto,
  ) {
    return this.changeRequests.addLink(projectId, id, user.id, dto);
  }

  @Delete(':id/links/:linkId')
  removeLink(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.changeRequests.removeLink(projectId, id, linkId, user.id);
  }

  /**
   * Record that the approved change reached the roadmap. The caller performs
   * the roadmap commit through the normal preview/commit protocol first and
   * passes the resulting change_id here — approval never writes the roadmap.
   */
  @Post(':id/applied')
  markApplied(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MarkChangeRequestAppliedDto,
  ) {
    return this.changeRequests.markApplied(projectId, id, user.id, dto);
  }

  @Delete(':id')
  remove(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.changeRequests.remove(projectId, id, user.id);
  }
}

@UseGuards(SupabaseAuthGuard)
@Controller('projects/:projectId/risks')
export class RisksController {
  constructor(private readonly risks: RisksService) {}

  @Get()
  list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListRisksQueryDto,
  ) {
    return this.risks.list(projectId, user.id, query);
  }

  /** Blocked tasks and at-risk milestones not yet in the register. */
  @Get('candidates')
  candidates(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.risks.candidates(projectId, user.id);
  }

  @Post()
  create(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRiskDto,
  ) {
    return this.risks.create(projectId, user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateRiskDto,
  ) {
    return this.risks.update(projectId, id, user.id, dto);
  }

  @Delete(':id')
  remove(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.risks.remove(projectId, id, user.id);
  }
}

@UseGuards(SupabaseAuthGuard)
@Controller('projects/:projectId/decisions')
export class DecisionsController {
  constructor(private readonly decisions: DecisionsService) {}

  @Get()
  list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDecisionsDto,
  ) {
    return this.decisions.list(projectId, user.id, query);
  }

  @Get(':id')
  get(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.decisions.get(projectId, id, user.id);
  }

  @Post()
  create(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDecisionDto,
  ) {
    return this.decisions.create(projectId, user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateDecisionDto,
  ) {
    return this.decisions.update(projectId, id, user.id, dto);
  }

  /**
   * proposed -> final. Kept out of PATCH so the decided_by/decided_on stamps
   * cannot be skipped, matching the deliverable submit/review endpoints.
   */
  @Post(':id/finalize')
  finalize(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.decisions.finalize(projectId, id, user.id);
  }

  @Post(':id/links')
  addLink(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LinkTargetDto,
  ) {
    return this.decisions.addLink(projectId, id, user.id, dto);
  }

  @Delete(':id/links/:linkId')
  removeLink(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.decisions.removeLink(projectId, id, linkId, user.id);
  }

  @Post(':id/options')
  addOption(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DecisionOptionInputDto,
  ) {
    return this.decisions.addOption(projectId, id, user.id, dto);
  }

  @Patch(':id/options/:optionId')
  updateOption(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Param('optionId') optionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateDecisionOptionDto,
  ) {
    return this.decisions.updateOption(projectId, id, optionId, user.id, dto);
  }

  @Delete(':id/options/:optionId')
  removeOption(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Param('optionId') optionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.decisions.removeOption(projectId, id, optionId, user.id);
  }

  @Delete(':id')
  remove(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.decisions.remove(projectId, id, user.id);
  }
}

@UseGuards(SupabaseAuthGuard)
@Controller('projects/:projectId/decision-categories')
export class DecisionCategoriesController {
  constructor(private readonly categories: DecisionCategoriesService) {}

  @Get()
  list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.categories.list(projectId, user.id);
  }

  @Post()
  create(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDecisionCategoryDto,
  ) {
    return this.categories.create(projectId, user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateDecisionCategoryDto,
  ) {
    return this.categories.update(projectId, id, user.id, dto);
  }

  @Delete(':id')
  remove(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.categories.remove(projectId, id, user.id);
  }
}
