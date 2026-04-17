import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { ProjectInvitationsService } from './project-invitations.service';
import {
  CreateInvitationLinkDto,
  ListInvitationRequestsQueryDto,
  ReviewInvitationRequestDto,
  SubmitInvitationRequestDto,
} from './dto/project-invitations.dto';

@Controller()
@UseGuards(SupabaseAuthGuard)
export class ProjectInvitationsController {
  constructor(private readonly service: ProjectInvitationsService) {}

  // ── Links ──────────────────────────────────────────────────────────────────

  @Get('projects/:id/invitation-links')
  getLinks(
    @Param('id') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getLinksForProject(projectId, user.id);
  }

  @Post('projects/:id/invitation-links')
  createLink(
    @Param('id') projectId: string,
    @Body() dto: CreateInvitationLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createLink(projectId, user.id, dto);
  }

  @Delete('projects/:id/invitation-links/:linkId')
  @HttpCode(HttpStatus.OK)
  revokeLink(
    @Param('id') projectId: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.revokeLink(projectId, linkId, user.id);
  }

  // ── Public link info ───────────────────────────────────────────────────────

  @Get('invitation-links/:token')
  @Public()
  getLinkInfo(@Param('token') token: string) {
    return this.service.getLinkInfo(token);
  }

  // ── Requests ───────────────────────────────────────────────────────────────

  @Post('invitation-links/:token/request')
  submitRequest(
    @Param('token') token: string,
    @Body() dto: SubmitInvitationRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.submitRequest(token, user.id, dto);
  }

  @Get('projects/:id/invitation-requests')
  getRequests(
    @Param('id') projectId: string,
    @Query() query: ListInvitationRequestsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getRequests(projectId, user.id, query);
  }

  @Patch('invitation-requests/:requestId')
  reviewRequest(
    @Param('requestId') requestId: string,
    @Body() dto: ReviewInvitationRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reviewRequest(requestId, user.id, dto);
  }
}
