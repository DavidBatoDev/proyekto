import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  ApplicationsQueryDto,
  GrantAdminDto,
  MatchAssignDto,
  MatchCandidatesQueryDto,
  RejectApplicationDto,
} from './dto/admin.dto';

@Controller('admin')
@UseGuards(SupabaseAuthGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('me')
  getAdminProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.adminService.getAdminProfile(user.id);
  }

  @Get('applications')
  @UseGuards(AdminGuard)
  listApplications(@Query() query: ApplicationsQueryDto) {
    return this.adminService.listApplications(query);
  }

  @Get('applications/:id')
  @UseGuards(AdminGuard)
  getApplicationDetail(@Param('id') id: string) {
    return this.adminService.getApplicationDetail(id);
  }

  @Post('applications/:id/approve')
  @UseGuards(AdminGuard)
  approveApplication(@Param('id') id: string) {
    return this.adminService.approveApplication(id);
  }

  @Post('applications/:id/reject')
  @UseGuards(AdminGuard)
  rejectApplication(
    @Param('id') id: string,
    @Body() dto: RejectApplicationDto,
  ) {
    return this.adminService.rejectApplication(id, dto);
  }

  @Get('admins')
  @UseGuards(AdminGuard)
  listAdmins() {
    return this.adminService.listAdmins();
  }

  @Post('admins/:userId/grant')
  @UseGuards(AdminGuard)
  grantAdmin(@Param('userId') userId: string, @Body() dto: GrantAdminDto) {
    return this.adminService.grantAdmin(userId, dto);
  }

  @Delete('admins/:userId/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminGuard)
  revokeAdmin(@Param('userId') userId: string) {
    return this.adminService.revokeAdmin(userId);
  }

  @Get('match-candidates')
  @UseGuards(AdminGuard)
  getMatchCandidates(@Query() query: MatchCandidatesQueryDto) {
    return this.adminService.getMatchCandidates(query);
  }

  @Post('match-assign')
  @UseGuards(AdminGuard)
  matchAssign(@Body() dto: MatchAssignDto) {
    return this.adminService.matchAssign(dto);
  }

  @Get('projects')
  @UseGuards(AdminGuard)
  listProjects() {
    return this.adminService.listProjects();
  }

  @Get('users')
  @UseGuards(AdminGuard)
  listUsers() {
    return this.adminService.listUsers();
  }
}
