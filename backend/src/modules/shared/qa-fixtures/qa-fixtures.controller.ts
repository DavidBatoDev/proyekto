import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { QaFixtureControlService } from './qa-fixture-control.service';
import { QaFixtureSecretGuard } from './qa-fixture-secret.guard';
import { ResetQaFixtureDto } from './dto/reset-qa-fixture.dto';

@Controller('internal/qa-fixtures')
export class QaFixturesController {
  constructor(private readonly control: QaFixtureControlService) {}

  @Post(':key/reset')
  @Public()
  @UseGuards(QaFixtureSecretGuard)
  reset(@Param('key') key: string, @Body() dto: ResetQaFixtureDto) {
    return this.control.reset(key, dto.mark_success ?? false);
  }
}
