import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  CreateAssignmentDto,
  EndAssignmentDto,
  EngagementListQueryDto,
  SetUpEngagementProjectDto,
} from './dto/engagements.dto';
import { EngagementAssignmentsService } from './engagement-assignments.service';
import { EngagementProjectService } from './engagement-project.service';
import { EngagementsService } from './engagements.service';

/**
 * Deliberately guarded by authentication alone. Engagement access is decided by
 * party membership inside the service, which is the rule that keeps Client and
 * Talent commercial sides apart. Adding ConsultantOnlyGuard here would gate on a
 * capability instead of the position that actually owns the row, and would lock
 * Clients and Talent out of reading their own agreements.
 */
@UseGuards(SupabaseAuthGuard)
@Controller('engagements')
export class EngagementsController {
  constructor(
    private readonly engagements: EngagementsService,
    private readonly engagementProjects: EngagementProjectService,
    private readonly assignments: EngagementAssignmentsService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EngagementListQueryDto,
  ) {
    return this.engagements.list(user.id, query);
  }

  /**
   * The caller's contract seats — including contracts with no engagement row
   * (legacy/seeded). Must be declared before `:id` so 'agreements' never hits
   * the UUID pipe.
   */
  @Get('agreements')
  listAgreements(@CurrentUser() user: AuthenticatedUser) {
    return this.engagements.listAgreements(user.id);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.engagements.getById(user.id, id);
  }

  /** What the project step needs: defaults, the team, linkable projects. */
  @Get(':id/project')
  projectDefaults(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.engagementProjects.defaults(user.id, id);
  }

  /** The step after signing: create or link the project, under the team. */
  @Post(':id/project')
  setUpProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUpEngagementProjectDto,
  ) {
    return this.engagementProjects.setUp(user.id, id, dto);
  }

  /**
   * Who works on which project under this engagement, any status. Parties
   * only (404 otherwise); the worker is named to provider-side parties only.
   */
  @Get(':id/assignments')
  listAssignments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.assignments.list(user.id, id);
  }

  /** Assign the engagement's worker to a project (talent: hirer; client: the consultant themselves). */
  @Post(':id/assignments')
  createAssignment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: CreateAssignmentDto,
  ) {
    return this.assignments.create(user.id, id, dto);
  }

  /** End an active assignment; a running timer under it stops at the end. */
  @Post(':id/assignments/:aid/end')
  @HttpCode(200)
  endAssignment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Param('aid', new ParseUUIDPipe({ errorHttpStatusCode: 404 }))
    assignmentId: string,
    @Body() dto: EndAssignmentDto,
  ) {
    return this.assignments.end(user.id, id, assignmentId, dto);
  }
}
