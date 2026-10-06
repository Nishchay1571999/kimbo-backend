import { ContinueAsGuestUseCase } from './application/continue-as-guest/continue-as-guest.use-case.js';
import { SignInUseCase } from './application/sign-in/sign-in.use-case.js';
import { CREDENTIAL_HASHER } from './domain/credential-hasher.js';
import { ScryptCredentialHasher } from './infrastructure/scrypt-credential-hasher.js';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module.js';
import { CreateAccountUseCase } from './application/create-account/create-account.use-case.js';
import { USER_REPOSITORY } from './domain/user.repository.js';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository.js';
import { AccountsController } from './presentation/accounts.controller.js';
import { GetSessionUseCase } from './application/get-session.use-case.js';
import { CompleteOnboardingUseCase } from './application/complete-onboarding.use-case.js';
import { ONBOARDING_REPOSITORY } from './domain/onboarding.repository.js';
import { PrismaOnboardingRepository } from './infrastructure/prisma-onboarding.repository.js';

@Module({
  imports: [PrismaModule],
  controllers: [AccountsController],
  providers: [
    GetSessionUseCase,
    CompleteOnboardingUseCase,
    { provide: ONBOARDING_REPOSITORY, useClass: PrismaOnboardingRepository },
    CreateAccountUseCase,
    ContinueAsGuestUseCase,
    SignInUseCase,
    { provide: CREDENTIAL_HASHER, useClass: ScryptCredentialHasher },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
})
export class IdentityModule {}
