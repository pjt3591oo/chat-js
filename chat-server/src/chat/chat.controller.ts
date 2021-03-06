import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateChatDto } from './chat.dto';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // 채팅목록
  @Get('/')
  async getChats(@Query() query) {
    return await this.chatService.getJoinChats(query.userId);
  }

  // 채팅방 생성
  @Post('/')
  async createChat(@Body() body: CreateChatDto) {
    const result = await this.chatService.createChat(body);
    return result;
  }

  // 메시지목록
  @Get('/:chatId')
  async getMessages(@Param() param, @Query() query) {
    const fromId = query.fromId;
    return await this.chatService.getChatMessages(
      param.chatId,
      fromId,
      query.userId,
    );
  }
}
