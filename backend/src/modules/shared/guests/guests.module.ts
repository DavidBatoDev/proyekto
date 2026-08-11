import { Module } from '@nestjs/common';
import { GuestsController, GuestsService } from './guests.controller';

@Module({
  controllers: [GuestsController],
  providers: [GuestsService],
})
export class GuestsModule {}
