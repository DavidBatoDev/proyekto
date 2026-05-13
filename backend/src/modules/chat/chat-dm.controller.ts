import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { ChatService } from './chat.service';
import {
  ChatMessagesQueryDto,
  SendDmMessageDto,
  ToggleChatReactionDto,
} from './dto/chat.dto';

/**
 * Global DM endpoints — no projectId in the path. DM threads are keyed on
 * the sorted user-pair, so one conversation per pair persists across every
 * project the two share.
 */
@UseGuards(SupabaseAuthGuard)
@Controller('chat/dm')
export class ChatDmController {
  constructor(private readonly chatService: ChatService) {}

  @Get('rooms')
  listRooms(@CurrentUser() user: AuthenticatedUser) {
    return this.chatService.listDmRooms(user.id);
  }

  @Get('eligible-members')
  listEligibleMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId?: string,
  ) {
    if (!projectId) {
      // No project context: return empty for now. The web layer always
      // passes a projectId from the in-project sidebar; a "new DM" search
      // surface in /inbox can call this without one later.
      return [];
    }
    return this.chatService.listDmEligibleMembers(projectId, user.id);
  }

  @Post('resolve')
  resolveDm(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { recipient_id: string },
  ) {
    return this.chatService.resolveDmRoom(user.id, body?.recipient_id);
  }

  @Get('rooms/:roomId/messages')
  listMessages(
    @Param('roomId') roomId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ChatMessagesQueryDto,
  ) {
    return this.chatService.listRoomMessages(
      roomId,
      user.id,
      query.before,
      query.limit,
    );
  }

  @Post('rooms/:roomId/read')
  markRoomRead(
    @Param('roomId') roomId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.markRoomRead(roomId, user.id);
  }

  @Post('messages')
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendDmMessageDto,
  ) {
    return this.chatService.sendDmMessage(user.id, dto);
  }

  @Post('messages/:messageId/reactions')
  toggleReaction(
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ToggleChatReactionDto,
  ) {
    return this.chatService.toggleMessageReaction(
      messageId,
      user.id,
      dto.emoji,
    );
  }

  @Delete('messages/:messageId')
  unsendMessage(
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.unsendMessage(messageId, user.id);
  }
}
