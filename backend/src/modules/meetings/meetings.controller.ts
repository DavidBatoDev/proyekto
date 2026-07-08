import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { MeetingsService } from './meetings.service';
import {
  CreateMeetingDto,
  ListMeetingsQueryDto,
  RescheduleMeetingDto,
  RespondMeetingDto,
  UpdateMeetingDto,
} from './dto/meeting.dto';

@Controller('meetings')
@UseGuards(SupabaseAuthGuard)
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMeetingDto,
  ) {
    return this.meetingsService.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMeetingsQueryDto,
  ) {
    return this.meetingsService.list(user.id, query);
  }

  @Get('project/:projectId')
  listForProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: ListMeetingsQueryDto,
  ) {
    return this.meetingsService.listForProject(user.id, projectId, query);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.meetingsService.getById(user.id, id);
  }

  @Patch(':id')
  reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RescheduleMeetingDto,
  ) {
    return this.meetingsService.reschedule(user.id, id, dto);
  }

  @Patch(':id/details')
  updateDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateMeetingDto,
  ) {
    return this.meetingsService.updateDetails(user.id, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.meetingsService.cancel(user.id, id);
  }

  @Post(':id/respond')
  @HttpCode(HttpStatus.OK)
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RespondMeetingDto,
  ) {
    return this.meetingsService.respond(user.id, id, dto);
  }
}
