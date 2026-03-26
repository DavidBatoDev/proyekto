import { Controller, Get, Param, Post, Query, Body, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { ChatService } from './chat.service';
import { ChatMessagesQueryDto, SendChatMessageDto } from './dto/chat.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('projects/:projectId/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('rooms')
  listRooms(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.listRooms(projectId, user.id);
  }

  @Get('members')
  listMembers(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.listMembers(projectId, user.id);
  }

  @Get('rooms/:roomId/messages')
  listMessages(
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ChatMessagesQueryDto,
  ) {
    return this.chatService.listRoomMessages(
      projectId,
      roomId,
      user.id,
      query.before,
      query.limit,
    );
  }

  @Post('messages')
  sendMessage(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendChatMessageDto,
  ) {
    return this.chatService.sendMessage(projectId, user.id, dto);
  }
}
