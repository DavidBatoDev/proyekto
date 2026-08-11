import { Global, Module } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeEmbeddingsService } from './knowledge-embeddings.service';
import { KnowledgeIngestSecretGuard } from './knowledge-ingest-secret.guard';
import { KnowledgeIngestService } from './knowledge-ingest.service';
import { KnowledgeOutboxService } from './knowledge-outbox.service';
import { KnowledgeSearchService } from './knowledge-search.service';

/**
 * Project knowledge pipeline (RAG): outbox ingestion of chat/comments/
 * activity/briefs into ai_knowledge_chunks + hybrid retrieval. Global (like
 * AuditModule) so write-path hooks in chat/roadmaps and the roadmap AI
 * endpoints inject its services without bespoke import wiring. Ships dark:
 * outbox writes are gated on KNOWLEDGE_INGEST_ENABLED and the cron endpoint
 * denies all callers until KNOWLEDGE_INGEST_SECRET is configured.
 */
@Global()
@Module({
  controllers: [KnowledgeController],
  providers: [
    KnowledgeEmbeddingsService,
    KnowledgeIngestSecretGuard,
    KnowledgeIngestService,
    KnowledgeOutboxService,
    KnowledgeSearchService,
  ],
  exports: [
    KnowledgeEmbeddingsService,
    KnowledgeOutboxService,
    KnowledgeSearchService,
  ],
})
export class KnowledgeModule {}
