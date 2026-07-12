import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { KnowledgeIngestSecretGuard } from './knowledge-ingest-secret.guard';
import { KnowledgeIngestService } from './knowledge-ingest.service';

/** Cron surface for the knowledge pipeline — exact mirror of
 * POST /meetings/cron/reminders (Cloud Scheduler + shared secret). */
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly ingest: KnowledgeIngestService) {}

  @Post('cron/ingest')
  @Public()
  @UseGuards(KnowledgeIngestSecretGuard)
  @HttpCode(HttpStatus.OK)
  runIngest() {
    return this.ingest.runIngest();
  }
}
