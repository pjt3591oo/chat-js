import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThan, MoreThan, Not, Repository } from 'typeorm';

import { Connection } from 'typeorm';

import { Chat } from 'src/entity/chat.entity';
import { JoinChat } from 'src/entity/joinChat.entity';
import { Message } from 'src/entity/message.entity';
import { User } from 'src/entity/user.entity';
import { CreateChatDto, MessageDto } from './chat.dto';
import { Check } from 'src/entity/check.entity';

/*
채팅목록 조회 + 마지막 채팅 포함
SELECT 
  * 
FROM 
  join_chat 
LEFT JOIN 
  chat 
ON
  chat.id = join_chat.chatId
LEFT JOIN 
  message
ON
  message.id = (SELECT id FROM message ORDER BY id DESC LIMIT 1)
    AND chat.id = message.chatId
WHERE 
  join_chat.userId= 1;
*/

@Injectable()
export class ChatService {
  constructor(
    private readonly connection: Connection,
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(JoinChat)
    private readonly joinChatRepository: Repository<JoinChat>,
    @InjectRepository(Check)
    private readonly checkRepository: Repository<Check>,
  ) {}

  // 채팅이 발생하면 마지막 메시지를 채팅 테이블에 저장?....
  async getJoinChats(userId: number): Promise<JoinChat[]> {
    const user: User = await this.userRepository.findOne(userId);

    return await this.joinChatRepository.find({
      where: {
        user,
      },
      relations: ['chat'],
    });
  }

  async getChatMessages(
    chatId: number,
    fromId: number,
    userId: number,
  ): Promise<{ checkedLastMessageId: number; messages: Message[] }> {
    // TODO: limit이 이상하게 동작하는거 같아서 일단 뻄...
    const chat: Chat = await this.chatRepository.findOne(chatId);
    const where = {
      chat,
      id: LessThan(fromId),
    };

    if (!fromId) delete where.id;

    const checkedLastMessage: JoinChat = await this.joinChatRepository.findOne({
      where: {
        chat: chatId,
        user: userId,
      },
      relations: ['checkedLastMessage'],
    });

    let checkedLastMessageId: number | null =
      checkedLastMessage?.checkedLastMessage?.id;

    checkedLastMessageId = checkedLastMessageId ? checkedLastMessageId : 0;

    // 각 메시지 읽은유저 + 1 업데이트
    await this.messageRepository
      .createQueryBuilder('message')
      .update(Message)
      .set({ readUserCnt: () => 'readUserCnt + 1' })
      .where({
        user: Not(userId),
        chat: chatId,
        id: MoreThan(checkedLastMessageId),
      })
      .execute();

    const messages: Message[] = await this.messageRepository.find({
      where,
      select: ['id', 'msg', 'msgType', 'createdAt', 'readUserCnt'],
      order: {
        createdAt: 'ASC',
      },
      relations: ['checks', 'user'],
      // take: 200,
    });

    // 읽지않은 목록수 0, 확인한 메시지를 마지막 메시지로 업데이트
    await this.joinChatRepository.save(checkedLastMessage);

    await this.joinChatRepository
      .createQueryBuilder('joinChat')
      .update(JoinChat)
      .set({
        checkedLastMessage: messages.length
          ? messages[messages.length - 1]
          : null,
        notReadMsgCnt: 0,
      })
      .where({
        chat: chatId,
        user: userId,
      })
      .execute();

    return {
      checkedLastMessageId,
      messages,
    };
  }

  async createChat(payloadChat: CreateChatDto) {
    const user: User = await this.userRepository.findOne(payloadChat.userId);
    const users: User[] = await this.userRepository.find({
      where: {
        id: In(payloadChat.joinIds),
      },
    });

    const queryRunner = this.connection.createQueryRunner();
    await queryRunner.startTransaction();
    try {
      const createdChat = await this.chatRepository.create({
        user,
        name: payloadChat.name,
        password: payloadChat.password,
        msg: '',
        msgType: '',
      });
      const chat = await queryRunner.manager.save(Chat, createdChat);
      const joineds: { user: User; chat: Chat }[] = [...users, user].map(
        (user: User) => ({
          user,
          chat,
        }),
      );
      const joinChats = await queryRunner.manager.save(JoinChat, joineds);
      await queryRunner.commitTransaction();
      await queryRunner.release();
      return {
        chat,
        joinChats,
      };
    } catch (err) {
      console.log(err);
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
      return {
        chat: {},
        joinChats: [],
      };
    }
  }

  async sendMsg(payloadMsg: MessageDto) {
    // Message row 생성
    const user: User = await this.userRepository.findOne(payloadMsg.userId);
    const chat: Chat = await this.chatRepository.findOne(payloadMsg.chatId);
    const joinChats: JoinChat[] = await this.joinChatRepository.find({
      where: { chat },
    });

    const queryRunner = this.connection.createQueryRunner();
    await queryRunner.startTransaction();

    try {
      const createdMsg: Message = await this.messageRepository.create({
        user,
        chat,
        msg: payloadMsg.msg,
        msgType: payloadMsg.msgType,
      });
      chat.msg = payloadMsg.msg;
      chat.msgType = payloadMsg.msgType;

      await queryRunner.manager.save(Chat, chat);
      const message: Message = await queryRunner.manager.save(
        Message,
        createdMsg,
      );

      const updateNotReadMsgCnt = joinChats.map((joinChat: JoinChat) => ({
        ...joinChat,
        notReadMsgCnt: joinChat.notReadMsgCnt + 1,
      }));

      await queryRunner.manager.save(JoinChat, updateNotReadMsgCnt);

      await queryRunner.commitTransaction();
      await queryRunner.release();

      return message;
    } catch (err) {
      console.log(err);
      await queryRunner.rollbackTransaction();
      await queryRunner.release();

      return {} as Message;
    }
  }

  async checkMsg(
    userId: number,
    chatId: number,
    toMessageId: number,
  ): Promise<boolean | [number, number]> {
    // 확인한 마지막 메시지(checkedLastMessageId)와 지금 확인한 메시지 아이디를 받는다.
    // 확인한 유저는 joinChat의 messageId를 업데이트
    // message에서 readUserCnt + 1
    const queryRunner = this.connection.createQueryRunner();
    await queryRunner.startTransaction();

    try {
      const joinChat: JoinChat = await this.joinChatRepository.findOne({
        where: {
          user: userId,
          chat: chatId,
        },
        relations: ['checkedLastMessage'],
      });
      const user: User = await this.userRepository.findOne({
        where: {
          id: userId,
        },
      });

      let checkedLastMessageId: number | null =
        joinChat?.checkedLastMessage?.id;
      checkedLastMessageId = checkedLastMessageId ? checkedLastMessageId : 0;

      // 읽은수 카운트 할 메시지 조회
      await this.messageRepository
        .createQueryBuilder('message')
        .update(Message)
        .set({ readUserCnt: () => 'readUserCnt + 1' })
        .where({
          user: Not(user.id),
          chat: chatId,
          id: Between(checkedLastMessageId + 1, toMessageId),
        })
        .execute();

      const checkedLastMessage: Message = await this.messageRepository.findOne({
        where: {
          id: toMessageId,
        },
      });

      // 확인한 마지막 메시지를 업데이트 한 마지막 메시지로 수정
      await this.joinChatRepository
        .createQueryBuilder('joinChat')
        .update(JoinChat)
        .set({
          notReadMsgCnt: 0,
          checkedLastMessage,
        })
        .where('userID=:userId AND chatId=:chatId', { userId, chatId })
        .execute();

      await queryRunner.commitTransaction();
      await queryRunner.release();

      return [checkedLastMessageId, toMessageId];
    } catch (err) {
      console.log(err);
      await queryRunner.rollbackTransaction();
      await queryRunner.release();

      return false;
    }
  }
}
