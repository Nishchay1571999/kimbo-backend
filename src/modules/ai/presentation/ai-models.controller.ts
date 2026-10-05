import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  CurrentUserGuard,
} from '../../../common/identity/current-user.js';
import type { UserIdentity } from '../../../common/identity/current-user.js';
import { AI_MODEL_REPOSITORY } from '../domain/ai-model.repository.js';
import type { AiModelRepository } from '../domain/ai-model.repository.js';
@Controller('v1/ai/models')
@UseGuards(CurrentUserGuard)
export class AiModelsController {
  constructor(
    @Inject(AI_MODEL_REPOSITORY) private readonly models: AiModelRepository,
  ) {}
  @Get() list(@CurrentUser() user: UserIdentity) {
    return this.models.list(user.userId);
  }
}
