import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../config/supabase.module';
import { AuthorizationModule } from '../projects/authorization/authorization.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ActivityController } from './activity.controller';
import { ChatController } from './chat.controller';
import { ChatDmController } from './chat-dm.controller';
import { ChatRoomsController } from './chat-rooms.controller';
import { CHAT_REPOSITORY, ChatService } from './chat.service';
import { SupabaseChatRepository } from './repositories/chat.repository.supabase';

@Module({
  imports: [SupabaseModule, AuthorizationModule, NotificationsModule],
  controllers: [
    ChatController,
    ChatDmController,
    ChatRoomsController,
    ActivityController,
  ],
  providers: [
    ChatService,
    { provide: CHAT_REPOSITORY, useClass: SupabaseChatRepository },
  ],
  exports: [ChatService],
})
export class ChatModule {}
