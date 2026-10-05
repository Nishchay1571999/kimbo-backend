import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  CurrentUserGuard,
} from '../../../common/identity/current-user.js';
import type { UserIdentity } from '../../../common/identity/current-user.js';
import { ChatRepository } from '../infrastructure/chat.repository.js';
import { SendMessageUseCase } from '../application/send-message.use-case.js';
import { AgentError } from '../../agent/domain/agent.types.js';
import {
  threadCursor,
  beforeSequence,
  createThreadInput,
  pageLimit,
  sendMessageInput,
  updateThreadInput,
} from './chat-input.js';
import { ChatStreamWriter } from './chat-stream.writer.js';
@Controller('v1/chat/threads')
@UseGuards(CurrentUserGuard)
export class ChatController {
  constructor(
    @Inject(ChatRepository) private readonly chats: ChatRepository,
    @Inject(SendMessageUseCase) private readonly send: SendMessageUseCase,
  ) {}
  @Post() create(@CurrentUser() user: UserIdentity, @Body() body: unknown) {
    const input = createThreadInput(body);
    return this.chats.create(user.userId, input.title, input.aiModelId);
  }
  @Get() list(
    @CurrentUser() user: UserIdentity,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.chats.list(user.userId, pageLimit(limit), threadCursor(cursor));
  }
  @Get(':id') get(
    @CurrentUser() user: UserIdentity,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.chats.get(user.userId, id);
  }
  @Patch(':id') update(
    @CurrentUser() user: UserIdentity,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.chats.update(user.userId, id, updateThreadInput(body));
  }
  @Delete(':id') @HttpCode(204) delete(
    @CurrentUser() user: UserIdentity,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.chats.delete(user.userId, id);
  }
  @Get(':id/messages') messages(
    @CurrentUser() user: UserIdentity,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.chats.messages(
      user.userId,
      id,
      pageLimit(limit),
      beforeSequence(before),
    );
  }
  @Post(':id/messages') async message(
    @CurrentUser() user: UserIdentity,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const input = sendMessageInput(body);
    const abort = new AbortController();
    const disconnect = () => {
      if (!response.writableEnded) abort.abort(new AgentError('CANCELLED'));
    };
    request.once('aborted', disconnect);
    response.once('close', disconnect);
    const timer = setTimeout(
      () => abort.abort(new AgentError('AI_TIMEOUT')),
      180_000,
    );
    try {
      // Authentication, ownership, validation and idempotency conflicts remain
      // ordinary HTTP errors. Only start the stream after durable allocation.
      const started = await this.send.begin(
        user.userId,
        id,
        input.requestId,
        input.message,
      );
      const writer = new ChatStreamWriter(response);
      try {
        await this.send.execute(user, started, writer.emit, abort.signal);
      } finally {
        await writer.end();
      }
    } finally {
      clearTimeout(timer);
      request.off('aborted', disconnect);
      response.off('close', disconnect);
    }
  }
}
