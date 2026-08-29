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
  Put,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SellerOnlyGuard } from '../../../common/guards/seller-only.guard';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { ServiceOfferingsService } from './service-offerings.service';
import {
  CreateServiceOfferingDto,
  ReorderServiceOfferingsDto,
  ReplaceOfferingPackagesDto,
  UpdateServiceOfferingDto,
} from './dto/service-offerings.dto';

/**
 * A seller's productised service catalog — the Fiverr-style offerings both
 * verified consultants and active talent list.
 *
 * Its own controller rather than more routes on `/api/profile` because that
 * one is the ACCOUNT-level surface shared with everyone; enrolment-gated
 * routes inside it would make half of it seller-only.
 *
 * Owner routes are SellerOnlyGuard (either enrolment); the two `public/*`
 * reads are anonymous with named column allowlists in the repository —
 * SupabaseAuthGuard honours `@Public()` via the reflector.
 */
@Controller('service-offerings')
@UseGuards(SupabaseAuthGuard)
export class ServiceOfferingsController {
  constructor(private readonly services: ServiceOfferingsService) {}

  // Public reads declared FIRST — Nest matches in declaration order and a
  // later `:id` pattern would swallow `public/...` as an id.

  /** Published offerings for a profile strip (talent or consultant). */
  @Public()
  @Get('public/by-user/:userId')
  listPublishedByUser(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.services.listPublishedByUser(userId);
  }

  /** The service detail page: offering + packages + seller card. */
  @Public()
  @Get('public/:id')
  getPublic(@Param('id', ParseUUIDPipe) id: string) {
    return this.services.getPublicById(id);
  }

  /** The owner's whole catalog, drafts included. Also feeds the contract picker. */
  @Get('mine')
  @UseGuards(SellerOnlyGuard)
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.services.listMine(user.id);
  }

  @Post()
  @UseGuards(SellerOnlyGuard)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateServiceOfferingDto,
  ) {
    return this.services.create(user.id, dto);
  }

  @Put('reorder')
  @UseGuards(SellerOnlyGuard)
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReorderServiceOfferingsDto,
  ) {
    return this.services.reorder(user.id, dto);
  }

  @Put(':id/packages')
  @UseGuards(SellerOnlyGuard)
  replacePackages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceOfferingPackagesDto,
  ) {
    return this.services.replacePackages(user.id, id, dto);
  }

  /**
   * The buyer-side save. Authenticated but NOT seller-gated: liking is
   * something any signed-in visitor does, and SellerOnlyGuard here would
   * mean only sellers could save a service.
   */
  @Get(':id/like')
  getLiked(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.services.getLiked(user.id, id);
  }

  @Put(':id/like')
  like(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.services.setLiked(user.id, id, true);
  }

  @Delete(':id/like')
  unlike(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.services.setLiked(user.id, id, false);
  }

  @Patch(':id')
  @UseGuards(SellerOnlyGuard)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceOfferingDto,
  ) {
    return this.services.update(user.id, id, dto);
  }

  @Delete(':id')
  @UseGuards(SellerOnlyGuard)
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.services.remove(user.id, id);
  }
}
