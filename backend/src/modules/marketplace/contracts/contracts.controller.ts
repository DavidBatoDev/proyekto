import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { ContractPageInitialsService } from './contract-page-initials.service';
import { ContractsService } from './contracts.service';
import { SaveContractInitialsDto } from './dto/contract-page-initials.dto';
import {
  AmendContractDto,
  CreateContractDto,
  MarkContractViewedDto,
  ResolveContractCounterpartyDto,
  ReseedProviderDto,
  SetSeatTeamDto,
  SignContractDto,
  UnsignContractDto,
  UpdateContractDto,
  UpdateSignaturePlacementDto,
} from './dto/contracts.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly initials: ContractPageInitialsService,
  ) {}

  @Get('project/:projectId')
  listByProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.contracts.listByProject(user.id, projectId);
  }

  /** Exact-email lookup only; this is not a general account directory. */
  @Post('counterparties/resolve')
  resolveCounterparty(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ResolveContractCounterpartyDto,
  ) {
    return this.contracts.resolveCounterparty(user.id, dto.email);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateContractDto,
  ) {
    return this.contracts.createContract(user.id, dto);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contracts.getContract(user.id, id);
  }

  /**
   * `If-Match: <revision>` pins the edit to the revision the editor read; a
   * stale one is a 409. Optional so older clients keep working (the service
   * still guards the write on the revision it loaded).
   */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractDto,
    @Headers('if-match') ifMatch?: string,
  ) {
    const parsed = ifMatch ? Number(ifMatch.replace(/[^0-9]/g, '')) : NaN;
    return this.contracts.updateContract(
      user.id,
      id,
      dto,
      Number.isInteger(parsed) && parsed > 0 ? parsed : undefined,
    );
  }

  /** Draft -> sent: the counterparty can now see it. Author only. */
  @Post(':id/send')
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contracts.sendContract(user.id, id);
  }

  /** Either party withdraws a sent contract (-> cancelled). */
  @Post(':id/withdraw')
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contracts.withdrawContract(user.id, id);
  }

  /** The caller's seat has reviewed the contract at this revision (rule 4). */
  @Post(':id/viewed')
  viewed(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkContractViewedDto,
  ) {
    return this.contracts.markViewed(user.id, id, dto.revision);
  }

  /** Negotiation revisions of this version. Seat holders only. */
  @Get(':id/revisions')
  revisions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contracts.listRevisions(user.id, id);
  }

  /** Every version in the family, with its frozen snapshot. */
  @Get(':id/history')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contracts.getHistory(user.id, id);
  }

  /** Deterministic field, service and clause diff between two versions. */
  @Get(':id/compare/:otherId')
  compare(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('otherId', ParseUUIDPipe) otherId: string,
  ) {
    return this.contracts.compareVersions(user.id, id, otherId);
  }

  /** The cached AI summary of a comparison, or a fresh one from the agent. */
  @Post(':id/compare/:otherId/summary')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('otherId', ParseUUIDPipe) otherId: string,
  ) {
    return this.contracts.summarizeComparison(user.id, id, otherId);
  }

  /**
   * The frozen PDF of a signed version, streamed. `X-Content-SHA256` carries
   * the stored hash and `X-Snapshot-Verified` whether the bytes still match.
   */
  @Get(':id/signed-pdf')
  async signedPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    // `@Res` rather than a return value: the global ResponseInterceptor wraps
    // returns in a JSON envelope, and a PDF is not envelope material.
    @Res() res: Response,
  ) {
    const pdf = await this.contracts.getSignedPdf(user.id, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(pdf.file_name)}"`,
    );
    res.setHeader('X-Content-SHA256', pdf.sha256 ?? '');
    res.setHeader('X-Snapshot-Verified', String(pdf.verified));
    res.setHeader('X-Snapshot-Kind', pdf.kind ?? '');
    res.setHeader('X-Snapshot-Taken-At', pdf.taken_at ?? '');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'X-Content-SHA256, X-Snapshot-Verified, X-Snapshot-Kind, X-Snapshot-Taken-At',
    );
    res.send(pdf.body);
  }

  /** Freeze signed contracts that predate freezing. Platform admins only. */
  @Post('admin/backfill-snapshots')
  @UseGuards(AdminGuard)
  backfillSnapshots() {
    return this.contracts.backfillSnapshots(50);
  }

  @Delete(':id')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contracts.deleteContract(user.id, id);
  }

  @Post(':id/sign')
  sign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignContractDto,
  ) {
    return this.contracts.signContract(user.id, id, dto);
  }

  /**
   * Per-page initials. Authorization rides on the same check as editing the
   * contract: only a party that may act on this agreement may mark its pages.
   */
  @Post(':id/initials')
  saveInitials(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveContractInitialsDto,
  ) {
    return this.contracts.savePageInitials(user.id, id, dto);
  }

  @Post(':id/unsign')
  unsign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UnsignContractDto,
  ) {
    return this.contracts.unsignContract(user.id, id, dto);
  }

  @Patch(':id/signature-placement')
  updateSignaturePlacement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSignaturePlacementDto,
  ) {
    return this.contracts.updateSignaturePlacement(user.id, id, dto);
  }

  /**
   * Change the terms of a signed contract from a chosen date onward. Creates
   * version + 1 as a draft; the current version governs until both parties
   * re-sign the new one.
   */
  @Post(':id/amend')
  amend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AmendContractDto,
  ) {
    return this.contracts.amendContract(user.id, id, dto);
  }

  /** Refill the provider block from the team record or the personal profile. */
  @Post(':id/provider')
  reseedProvider(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReseedProviderDto,
  ) {
    return this.contracts.reseedProvider(
      user.id,
      id,
      dto.provider_kind,
      dto.team_id,
    );
  }

  /** Which of the caller's own teams their seat signs on behalf of. */
  @Patch(':id/positions/:position/team')
  setSeatTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param(
      'position',
      new ParseEnumPipe({ hirer: 'hirer', provider: 'provider' }),
    )
    position: 'hirer' | 'provider',
    @Body() dto: SetSeatTeamDto,
  ) {
    return this.contracts.setSeatTeam(user.id, id, position, dto.team_id);
  }

  /** Teams the caller owns — never the counterparty's. */
  @Get(':id/my-teams')
  myTeams(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contracts.myTeamsForContract(user.id, id);
  }
}
