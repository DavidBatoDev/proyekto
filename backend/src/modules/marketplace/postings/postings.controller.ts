import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ConsultantOnlyGuard } from '../../../common/guards/consultant-only.guard';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { BriefGeneratorService } from './brief-generator.service';
import {
  AddPostingAttachmentDto,
  BoardQueryDto,
  CreatePostingDto,
  GenerateBriefDto,
  SubmitProposalDto,
  TriageProposalDto,
  UpdatePostingDto,
} from './dto/postings.dto';
import { PostingsService } from './postings.service';

/**
 * Project briefs: the marketplace's demand side.
 *
 * Authoring is open to any signed-in user — "is this person a client?" is a
 * malformed question, and publishing a brief is what makes somebody the client
 * of that piece of work. Discovery and proposing are consultant-only, which is
 * the one asymmetry here and matches the talent pool's gate.
 *
 * Everything goes through this controller rather than direct-from-web Supabase
 * calls. `project_briefs` took the other road and now has two divergent write
 * paths and no server-side validation of its own.
 */
@Controller('postings')
@UseGuards(SupabaseAuthGuard)
export class PostingsController {
  constructor(
    private readonly postings: PostingsService,
    private readonly generator: BriefGeneratorService,
  ) {}

  /**
   * Draft a brief from one paragraph. Returns sections for the editor to show;
   * it never creates or publishes anything — the author approves every word.
   */
  @Post('generate')
  @HttpCode(200)
  generate(@Body() dto: GenerateBriefDto) {
    return this.generator.generate(dto.description, dto.category_hint);
  }

  // ── Author surface ───────────────────────────────────────────────────────

  /** The author's own briefs, drafts included. */
  @Get('mine')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.postings.listMine(user.id);
  }

  /** The consultant board. Declared before `:id` so it is not swallowed by it. */
  @Get('board')
  @UseGuards(ConsultantOnlyGuard)
  board(@Query() query: BoardQueryDto) {
    return this.postings.board(query);
  }

  /** A consultant's own proposals, across every brief. */
  @Get('proposals/mine')
  @UseGuards(ConsultantOnlyGuard)
  listMyProposals(@CurrentUser() user: AuthenticatedUser) {
    return this.postings.listMyProposals(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePostingDto,
  ) {
    return this.postings.create(user.id, dto);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.postings.getDetail(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePostingDto,
  ) {
    return this.postings.update(user.id, id, dto);
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.postings.publish(user.id, id);
  }

  @Post(':id/close')
  @HttpCode(200)
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.postings.close(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.postings.remove(user.id, id);
  }

  // ── Attachments ──────────────────────────────────────────────────────────

  @Post(':id/attachments')
  addAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddPostingAttachmentDto,
  ) {
    return this.postings.addAttachment(user.id, id, dto);
  }

  @Delete(':id/attachments/:attachmentId')
  @HttpCode(204)
  async removeAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ): Promise<void> {
    await this.postings.removeAttachment(user.id, id, attachmentId);
  }

  // ── Proposals ────────────────────────────────────────────────────────────

  /** The author's applicant list. */
  @Get(':id/proposals')
  listProposals(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.postings.listProposals(user.id, id);
  }

  /** Apply. Re-applying edits the existing pitch rather than stacking a second. */
  @Post(':id/proposals')
  @UseGuards(ConsultantOnlyGuard)
  submitProposal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitProposalDto,
  ) {
    return this.postings.submitProposal(user.id, id, dto);
  }

  @Post('proposals/:proposalId/withdraw')
  @HttpCode(200)
  @UseGuards(ConsultantOnlyGuard)
  withdrawProposal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
  ) {
    return this.postings.withdrawProposal(user.id, proposalId);
  }

  /** Shortlist or decline. The author's only write on somebody else's words. */
  @Patch('proposals/:proposalId')
  triageProposal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() dto: TriageProposalDto,
  ) {
    return this.postings.triageProposal(user.id, proposalId, dto);
  }
}
