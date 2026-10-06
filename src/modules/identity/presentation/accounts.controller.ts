import { ContinueAsGuestResponseDto } from './dto/continue-as-guest-response.dto.js';
import { ContinueAsGuestUseCase } from '../application/continue-as-guest/continue-as-guest.use-case.js';
import { ContinueAsGuestDto } from './dto/continue-as-guest.dto.js';
import {
  Body,
  Catch,
  Controller,
  Inject,
  HttpCode,
  Header,
  Headers,
  Get,
  Post,
  UseFilters,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ConflictError } from '../../../common/errors/conflict.error.js';
import {
  DomainError,
  AuthenticationError,
  InvalidInputError,
} from '../../../common/errors/domain.error.js';
import { CreateAccountUseCase } from '../application/create-account/create-account.use-case.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { SignInUseCase } from '../application/sign-in/sign-in.use-case.js';
import { SignInDto } from './dto/sign-in.dto.js';
import { SignInResponseDto } from './dto/sign-in-response.dto.js';
import { AccountResponseDto } from './dto/account-response.dto.js';
import { GetSessionUseCase } from '../application/get-session.use-case.js';
import { CompleteOnboardingUseCase } from '../application/complete-onboarding.use-case.js';

@Catch(DomainError)
class AccountErrorFilter implements ExceptionFilter<DomainError> {
  catch(error: DomainError, host: ArgumentsHost): void {
    const status =
      error instanceof ConflictError
        ? 409
        : error instanceof InvalidInputError
          ? 400
          : error instanceof AuthenticationError
            ? 401
            : 500;
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({
        statusCode: status,
        code: error.code,
        message: status === 500 ? 'Internal server error' : error.message,
      });
  }
}

@Controller('v1/accounts')
@UseFilters(AccountErrorFilter)
export class AccountsController {
  constructor(
    @Inject(CompleteOnboardingUseCase) private readonly completeOnboarding: CompleteOnboardingUseCase,
    @Inject(GetSessionUseCase) private readonly getSession: GetSessionUseCase,
    @Inject(CreateAccountUseCase)
    private readonly createAccount: CreateAccountUseCase,
    @Inject(SignInUseCase) private readonly signIn: SignInUseCase,
    @Inject(ContinueAsGuestUseCase)
    private readonly continueAsGuest: ContinueAsGuestUseCase,
  ) {}

  @Post('onboarding')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async onboarding(@Headers('authorization') authorization: string | undefined, @Body() body: unknown): Promise<AccountResponseDto> {
    return AccountResponseDto.fromUser(await this.completeOnboarding.execute(authorization, body));
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  async me(@Headers('authorization') authorization?: string): Promise<AccountResponseDto> {
    return AccountResponseDto.fromUser(await this.getSession.execute(authorization));
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      expectedType: CreateAccountDto,
    }),
  )
  async create(@Body() dto: CreateAccountDto): Promise<AccountResponseDto> {
    const user = await this.createAccount.execute({
      authProviderId: dto.authProviderId ?? dto.auth_provider_id,
      name: dto.name,
      email: dto.email,
      password: dto.password,
      timezone: dto.timezone,
    });
    return AccountResponseDto.fromUser(user);
  }
  @Post('continue-as-guest')
  @Header('Cache-Control', 'no-store')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      expectedType: ContinueAsGuestDto,
    }),
  )
  async guest(
    @Body() dto: ContinueAsGuestDto,
  ): Promise<ContinueAsGuestResponseDto> {
    const result = await this.continueAsGuest.execute({
      timezone: dto?.timezone,
    });
    return Object.assign(
      new ContinueAsGuestResponseDto(),
      AccountResponseDto.fromUser(result.user),
      {
        auth_provider_id: result.token,
        token: result.token,
        tokenType: 'Bearer' as const,
      },
    );
  }

  @Post('sign-in')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      expectedType: SignInDto,
    }),
  )
  async authenticate(@Body() dto: SignInDto): Promise<SignInResponseDto> {
    const result = await this.signIn.execute({
      email: dto.email,
      password: dto.password,
    });
    return Object.assign(
      new SignInResponseDto(),
      AccountResponseDto.fromUser(result.user),
      {
        token: result.token,
        tokenType: 'Bearer' as const,
      },
    );
  }
}
