import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../config/supabase.module';
import { ChatController } from './chat.controller';
import { CHAT_REPOSITORY, ChatService } from './chat.service';
import { SupabaseChatRepository } from './repositories/chat.repository.supabase';

@Module({
  imports: [SupabaseModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    { provide: CHAT_REPOSITORY, useClass: SupabaseChatRepository },
  ],
})
export class ChatModule {}
