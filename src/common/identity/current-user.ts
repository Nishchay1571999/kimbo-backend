import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Module,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PrismaModule } from '../database/prisma.module.js';
import { PrismaService } from '../database/prisma.service.js';

export interface UserIdentity {
  userId: string;
  timezone: string;
  development: boolean;
}
type UserRequest = Request & { currentUser: UserIdentity };
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserIdentity =>
    context.switchToHttp().getRequest<UserRequest>().currentUser,
);
@Injectable()
export class CurrentUserGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserRequest>();
    const authorization = request.headers.authorization;
    const development =
      !authorization &&
      this.config.get('DEV_AUTH_ENABLED') === 'true' &&
      this.config.get('NODE_ENV') !== 'production';
    let where;
    if (development) {
      const userId = this.config.get<string>('DEV_USER_ID');
      where = userId
        ? { id: userId }
        : {
            email:
              this.config.get<string>('DEV_USER_EMAIL') ?? 'test@email.com',
          };
    } else {
      const token = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
      if (!token) throw new UnauthorizedException('Bearer token required');
      where = { authProviderId: token };
    }
    const user = await this.prisma.client.user.findUnique({
      where,
      select: { id: true, timezone: true, onboardingCompletedAt: true },
    });
    if (!user) throw new UnauthorizedException('User identity not found');
    if (!development && !user.onboardingCompletedAt)
      throw new ForbiddenException('Complete onboarding first');
    request.currentUser = {
      userId: user.id,
      timezone: user.timezone,
      development,
    };
    return true;
  }
}
@Module({
  imports: [PrismaModule],
  providers: [CurrentUserGuard],
  exports: [CurrentUserGuard, PrismaModule],
})
export class CurrentUserModule {}
