import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import { PrismaService } from './prisma.service.js';

const client = vi.hoisted(() => ({
  $connect: vi.fn(),
  $queryRaw: vi.fn(),
  $disconnect: vi.fn(),
}));

vi.mock('./prisma-client.js', () => ({
  createPrismaClient: () => client,
}));

describe('PrismaService lifecycle', () => {
  let service: PrismaService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new PrismaService(
      new ConfigService({ DATABASE_URL: 'postgresql://example' }),
    );
  });

  it('requires DATABASE_URL before creating a client', () => {
    expect(() => new PrismaService(new ConfigService())).toThrow(
      'DATABASE_URL',
    );
  });

  it('executes a real query at startup because the driver pool connects lazily', async () => {
    await service.onModuleInit();
    expect(client.$connect).toHaveBeenCalledOnce();
    expect(client.$queryRaw).toHaveBeenCalledOnce();
    expect(client.$disconnect).not.toHaveBeenCalled();
  });

  it('closes the pool and fails startup if the database query fails', async () => {
    const error = new Error('authentication failed');
    client.$queryRaw.mockRejectedValueOnce(error);
    await expect(service.onModuleInit()).rejects.toBe(error);
    expect(client.$disconnect).toHaveBeenCalledOnce();
  });

  it('closes the pool on application shutdown', async () => {
    await service.onModuleDestroy();
    expect(client.$disconnect).toHaveBeenCalledOnce();
  });
});
