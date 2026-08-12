import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { ContractsService } from './contracts.service';
import {
  AmendContractDto,
  CreateContractDto,
  ReseedProviderDto,
  SignContractDto,
  UnsignContractDto,
  UpdateContractDto,
  UpdateSignaturePlacementDto,
} from './dto/contracts.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get('project/:projectId')
  listByProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.contracts.listByProject(user.id, projectId);
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

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractDto,
  ) {
    return this.contracts.updateContract(user.id, id, dto);
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
}
