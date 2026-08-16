import { Module } from '@nestjs/common';
import { QaFixtureControlService } from './qa-fixture-control.service';
import { QaFixturePolicyService } from './qa-fixture-policy.service';
import { QaFixtureSecretGuard } from './qa-fixture-secret.guard';
import { QaFixturesController } from './qa-fixtures.controller';

@Module({
  controllers: [QaFixturesController],
  providers: [
    QaFixtureControlService,
    QaFixturePolicyService,
    QaFixtureSecretGuard,
  ],
  exports: [QaFixturePolicyService],
})
export class QaFixturesModule {}
