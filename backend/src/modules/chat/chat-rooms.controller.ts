import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
  EditMessageDto,
  SearchMessagesQueryDto,
  ToggleChatReactionDto,
} from './dto/chat.dto';

/**
 * Room-agnostic chat endpoints: message history, reactions, unsend, and
 * read-pointer updates work for both project channels and global DMs because
 * the service verifies access via the room's type. Callers do not need to
 * know whether a room is a DM or a channel.
 */
@UseGuards(SupabaseAuthGuard)
@Controller('chat')
export class ChatRoomsController {
  constructor(private readonly chatService: ChatService) {}

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

  @Get('rooms/:roomId/messages/search')
  searchMessages(
    @Param('roomId') roomId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchMessagesQueryDto,
  ) {
    return this.chatService.searchRoomMessages(
      roomId,
      user.id,
      query.q,
      query.limit,
    );
  }

  @Get('rooms/:roomId/library')
  getRoomLibrary(
    @Param('roomId') roomId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.getRoomLibrary(roomId, user.id);
  }

  @Post('rooms/:roomId/read')
  markRoomRead(
    @Param('roomId') roomId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.markRoomRead(roomId, user.id);
  }

  @Post('rooms/:roomId/star')
  toggleRoomStar(
    @Param('roomId') roomId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.toggleRoomStar(roomId, user.id);
  }

  @Post('messages/:messageId/reactions')
  toggleReaction(
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ToggleChatReactionDto,
  ) {
    return this.chatService.toggleMessageReaction(messageId, user.id, dto.emoji);
  }

  @Patch('messages/:messageId')
  editMessage(
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EditMessageDto,
  ) {
    return this.chatService.editMessage(messageId, user.id, dto);
  }

  @Delete('messages/:messageId')
  unsendMessage(
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.unsendMessage(messageId, user.id);
  }
}
