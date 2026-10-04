import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from './prisma-client.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(config: ConfigService) {
    this.client = createPrismaClient(config.getOrThrow<string>('DATABASE_URL'));
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
      // Driver pools connect lazily; execute a query to fail early on bad credentials.
      await this.client.$queryRaw`SELECT 1`;
    } catch (error) {
      await this.client.$disconnect();
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
