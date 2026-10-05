import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service.js';
import type { AiModelRepository } from '../domain/ai-model.repository.js';
const select = {
  id: true,
  name: true,
  provider: true,
  providerModelId: true,
  supportsText: true,
  supportsImages: true,
  supportsAudio: true,
};
function allowed(audio = false) {
  return {
    provider: 'openrouter',
    isAvailable: true,
    supportsText: true,
    supportsImages: true,
    ...(audio ? { supportsAudio: true } : {}),
  };
}
@Injectable()
export class PrismaAiModelRepository implements AiModelRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  selectForEntry(_userId: string, audio: boolean) {
    return this.prisma.client.aiModel.findFirst({
      where: allowed(audio),
      select,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  findAllowed(_userId: string, providerModelId: string, audio: boolean) {
    return this.prisma.client.aiModel.findFirst({
      where: { ...allowed(audio), providerModelId },
      select,
    });
  }
  list(_userId: string) {
    return this.prisma.client.aiModel.findMany({
      where: allowed(),
      select,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
