import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RawResponse } from '../../../common/decorators/raw-response.decorator';
import type { CapgoCheckBody, CapgoStatsBody } from './dto/capgo.types';
import type { RequirementQuery } from './dto/requirements.types';
import { PresignBundleDto, RegisterBundleDto } from './dto/publish-bundle.dto';
import { OtaPublishGuard } from './guards/ota-publish.guard';
import { MobileUpdatesService } from './mobile-updates.service';

@Controller('mobile-updates')
export class MobileUpdatesController {
  constructor(private readonly service: MobileUpdatesService) {}

  // ---- Capgo plugin endpoints (PUBLIC: native HTTP, no JWT) ----
  // Body typed as a plain interface so the global ValidationPipe skips it
  // (Object metatype) — the plugin's extra/future fields never 400.
  // @RawResponse() bypasses the global `{ data }` envelope so Capgo gets the
  // `{ version, url, checksum }` / `{ error }` shape it expects.

  @Post('check')
  @HttpCode(200)
  @RawResponse()
  check(@Body() body: CapgoCheckBody) {
    return this.service.resolveUpdate(body);
  }

  @Post('stats')
  @HttpCode(200)
  @RawResponse()
  stats(@Body() body: CapgoStatsBody) {
    this.service.recordStat(body);
    return { ok: true };
  }

  // ---- Native update gate (PUBLIC: the app asks before/without a session) ----
  // Keeps the global `{ data }` envelope — this one is consumed by our own web
  // client via axios, not by the Capgo plugin.

  @Get('requirements')
  requirements(@Query() query: RequirementQuery) {
    return this.service.resolveRequirement(query);
  }

  // ---- Publish endpoints (CI only: Bearer OTA_PUBLISH_TOKEN) ----
  // These keep the global `{ data }` envelope; CI reads `.data`.

  @Post('bundles/presign')
  @UseGuards(OtaPublishGuard)
  presign(@Body() dto: PresignBundleDto) {
    return this.service.presign(dto);
  }

  @Post('bundles')
  @UseGuards(OtaPublishGuard)
  register(@Body() dto: RegisterBundleDto) {
    return this.service.register(dto);
  }
}
