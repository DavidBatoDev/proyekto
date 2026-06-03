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
  Put,
  UseGuards,
} from '@nestjs/common';
import { ProfileService } from './profile.service';
import { PhoneOtpService } from './phone-otp.service';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import {
  AddCertificationDto,
  AddEducationDto,
  AddExperienceDto,
  AddIdentityDocumentDto,
  AddLanguageDto,
  AddLicenseDto,
  AddPortfolioDto,
  AddSpecializationDto,
  PhoneVerificationConfirmDto,
  ReplaceSkillsDto,
  UpdateCertificationDto,
  UpdateEducationDto,
  UpdateExperienceDto,
  UpdateLanguageDto,
  UpdateLicenseDto,
  UpdatePortfolioDto,
  UpdateProfileBasicDto,
  UpdateSpecializationDto,
  UpsertRateSettingsDto,
} from './dto/profile.dto';

@Controller('profile')
@UseGuards(SupabaseAuthGuard)
export class ProfileController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly phoneOtpService: PhoneOtpService,
  ) {}

  @Get('meta/skills')
  getAllSkills() {
    return this.profileService.getAllSkills();
  }

  @Get('meta/languages')
  getAllLanguages() {
    return this.profileService.getAllLanguages();
  }

  @Get(':id')
  getFullProfile(@Param('id') id: string) {
    return this.profileService.getFullProfile(id);
  }

  @Patch()
  updateBasic(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileBasicDto,
  ) {
    return this.profileService.updateBasic(user.id, dto);
  }

  // Skills
  @Put('skills')
  replaceSkills(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReplaceSkillsDto,
  ) {
    return this.profileService.replaceSkills(user.id, dto);
  }

  // Languages
  @Post('languages')
  addLanguage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddLanguageDto,
  ) {
    return this.profileService.addLanguage(user.id, dto);
  }

  @Patch('languages/:id')
  updateLanguage(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateLanguageDto,
  ) {
    return this.profileService.updateLanguage(id, user.id, dto);
  }

  @Delete('languages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLanguage(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.profileService.deleteLanguage(id, user.id);
  }

  // Educations
  @Post('educations')
  addEducation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddEducationDto,
  ) {
    return this.profileService.addEducation(user.id, dto);
  }

  @Patch('educations/:id')
  updateEducation(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateEducationDto,
  ) {
    return this.profileService.updateEducation(id, user.id, dto);
  }

  @Delete('educations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteEducation(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.profileService.deleteEducation(id, user.id);
  }

  // Certifications
  @Post('certifications')
  addCertification(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddCertificationDto,
  ) {
    return this.profileService.addCertification(user.id, dto);
  }

  @Patch('certifications/:id')
  updateCertification(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCertificationDto,
  ) {
    return this.profileService.updateCertification(id, user.id, dto);
  }

  @Delete('certifications/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCertification(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.profileService.deleteCertification(id, user.id);
  }

  // Experiences
  @Post('experiences')
  addExperience(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddExperienceDto,
  ) {
    return this.profileService.addExperience(user.id, dto);
  }

  @Patch('experiences/:id')
  updateExperience(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateExperienceDto,
  ) {
    return this.profileService.updateExperience(id, user.id, dto);
  }

  @Delete('experiences/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteExperience(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.profileService.deleteExperience(id, user.id);
  }

  // Portfolios
  @Post('portfolios')
  addPortfolio(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddPortfolioDto,
  ) {
    return this.profileService.addPortfolio(user.id, dto);
  }

  @Patch('portfolios/:id')
  updatePortfolio(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePortfolioDto,
  ) {
    return this.profileService.updatePortfolio(id, user.id, dto);
  }

  @Delete('portfolios/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePortfolio(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.profileService.deletePortfolio(id, user.id);
  }

  // Rate settings
  @Put('rate-settings')
  upsertRateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertRateSettingsDto,
  ) {
    return this.profileService.upsertRateSettings(user.id, dto);
  }

  // Licenses
  @Post('licenses')
  addLicense(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddLicenseDto,
  ) {
    return this.profileService.addLicense(user.id, dto);
  }

  @Patch('licenses/:id')
  updateLicense(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateLicenseDto,
  ) {
    return this.profileService.updateLicense(id, user.id, dto);
  }

  @Delete('licenses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLicense(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.profileService.deleteLicense(id, user.id);
  }

  // Specializations
  @Post('specializations')
  addSpecialization(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddSpecializationDto,
  ) {
    return this.profileService.addSpecialization(user.id, dto);
  }

  @Patch('specializations/:id')
  updateSpecialization(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSpecializationDto,
  ) {
    return this.profileService.updateSpecialization(id, user.id, dto);
  }

  @Delete('specializations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSpecialization(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.profileService.deleteSpecialization(id, user.id);
  }

  // Phone verification
  @Post('phone-verification/request')
  @HttpCode(HttpStatus.OK)
  requestPhoneVerification(@CurrentUser() user: AuthenticatedUser) {
    return this.phoneOtpService.requestPhoneVerification(user.id);
  }

  @Post('phone-verification/confirm')
  @HttpCode(HttpStatus.OK)
  confirmPhoneVerification(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PhoneVerificationConfirmDto,
  ) {
    return this.phoneOtpService.confirmPhoneVerification(user.id, dto.code);
  }

  // Identity documents
  @Post('identity_documents')
  addIdentityDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddIdentityDocumentDto,
  ) {
    return this.profileService.addIdentityDocument(user.id, dto);
  }

  @Delete('identity_documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteIdentityDocument(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.profileService.deleteIdentityDocument(id, user.id);
  }
}
