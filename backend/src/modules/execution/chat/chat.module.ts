import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { AuthorizationModule } from '../projects/authorization/authorization.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { PushModule } from '../../shared/push/push.module';
import { ChatController } from './chat.controller';
import { ChatDmController } from './chat-dm.controller';
import { ChatRoomsController } from './chat-rooms.controller';
import { ChatPushService } from './chat-push.service';
import { ChatService } from './chat.service';
import { CHAT_REPOSITORY } from './chat.tokens';
import { SupabaseChatRepository } from './repositories/chat.repository.supabase';

@Module({
  imports: [
    SupabaseModule,
    AuthorizationModule,
    NotificationsModule,
    PushModule,
  ],
  controllers: [ChatController, ChatDmController, ChatRoomsController],
  providers: [
    ChatService,
    ChatPushService,
    { provide: CHAT_REPOSITORY, useClass: SupabaseChatRepository },
  ],
  exports: [ChatService],
})
export class ChatModule {}
