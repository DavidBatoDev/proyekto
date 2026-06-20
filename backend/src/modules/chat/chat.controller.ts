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
  ChannelMemberDto,
  ChatMessagesQueryDto,
  CreateChannelDto,
  SendChannelMessageDto,
  ToggleChatReactionDto,
  UpdateChannelDto,
} from './dto/chat.dto';

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

  // ── Channel management ────────────────────────────────────────────────────

  @Post('channels')
  createChannel(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateChannelDto,
  ) {
    return this.chatService.createChannel(projectId, user.id, dto);
  }

  @Patch('channels/:roomId')
  updateChannel(
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.chatService.updateChannel(projectId, user.id, roomId, dto);
  }

  @Get('channels/:roomId/members')
  listChannelMembers(
    @Param('roomId') roomId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.listChannelMembers(roomId, user.id);
  }

  @Post('channels/:roomId/members')
  addChannelMember(
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChannelMemberDto,
  ) {
    return this.chatService.addChannelMember(
      projectId,
      user.id,
      roomId,
      dto.user_id,
    );
  }

  @Delete('channels/:roomId/members/:memberId')
  removeChannelMember(
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.removeChannelMember(
      projectId,
      user.id,
      roomId,
      memberId,
    );
  }

  @Delete('channels/:roomId/leave')
  leaveChannel(
    @Param('projectId') projectId: string,
    @Param('roomId') roomId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.leaveChannel(projectId, user.id, roomId);
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
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendChannelMessageDto,
  ) {
    return this.chatService.sendChannelMessage(projectId, user.id, dto);
  }

  @Post('messages/:messageId/reactions')
  toggleReaction(
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ToggleChatReactionDto,
  ) {
    return this.chatService.toggleMessageReaction(messageId, user.id, dto.emoji);
  }

  @Delete('messages/:messageId')
  unsendMessage(
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.unsendMessage(messageId, user.id);
  }
}
