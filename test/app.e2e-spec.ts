import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/common/database/prisma.service.js';
import { vi } from 'vitest';
import { USER_REPOSITORY } from '../src/modules/identity/domain/user.repository.js';
import { ConflictError } from '../src/common/errors/conflict.error.js';
import { ONBOARDING_REPOSITORY } from '../src/modules/identity/domain/onboarding.repository.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const query = vi.fn();
  const findByEmail = vi.fn();
  const findByAuthProviderId = vi.fn();
  const completeOnboarding = vi.fn();
  const create = vi.fn();
  const registerGuest = vi.fn();
  const findCredentialsByEmail = vi.fn();

  beforeEach(async () => {
    completeOnboarding.mockReset();
    findByAuthProviderId.mockReset().mockResolvedValue(null);
    registerGuest.mockReset();
    findCredentialsByEmail.mockReset().mockResolvedValue(null);
    findByEmail.mockReset().mockResolvedValue(null);
    create.mockReset().mockImplementation(async (input) => ({
      ...input,
      id: 'c115c629-d911-42aa-8e51-4a7d6db658ed',
      onboardingCompletedAt: null,
    }));
    query.mockReset().mockResolvedValue([{ ok: 1 }]);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ client: { $queryRaw: query } })
      .overrideProvider(USER_REPOSITORY)
      .useValue({ findByEmail, findByAuthProviderId, findCredentialsByEmail, create, registerGuest })
      .overrideProvider(ONBOARDING_REPOSITORY)
      .useValue({ complete: completeOnboarding })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('restores an incomplete account without exposing credentials', async () => {
    findByAuthProviderId.mockResolvedValue({
      id: 'c115c629-d911-42aa-8e51-4a7d6db658ed', name: 'Test', email: 'test@email.com',
      accountStatus: 'member', timezone: 'Asia/Kolkata', onboardingCompletedAt: null,
      passwordHash: 'private', authProviderId: 'private-token',
    });
    const response = await request(app.getHttpServer()).get('/v1/accounts/me')
      .set('Authorization', 'Bearer private-token').expect('Cache-Control', 'no-store').expect(200);
    expect(response.body).toEqual({
      id: 'c115c629-d911-42aa-8e51-4a7d6db658ed', name: 'Test', email: 'test@email.com',
      accountStatus: 'member', timezone: 'Asia/Kolkata', onboardingCompleted: false,
    });
    expect(findByAuthProviderId).toHaveBeenCalledWith('private-token');
  });

  it.each([undefined, 'Basic token', 'Bearer', 'Bearer token extra', 'Bearer unknown'])
    ('rejects invalid session credentials %s', async (authorization) => {
      const call = request(app.getHttpServer()).get('/v1/accounts/me');
      if (authorization) call.set('Authorization', authorization);
      await call.expect(401);
    });

  it('completes onboarding using the bearer owner and rejects client ownership fields', async () => {
    const user = { id: 'c115c629-d911-42aa-8e51-4a7d6db658ed', name: 'Test', email: 'test@email.com',
      accountStatus: 'member', timezone: 'Asia/Kolkata', onboardingCompletedAt: null };
    findByAuthProviderId.mockResolvedValue(user);
    completeOnboarding.mockResolvedValue({ ...user, onboardingCompletedAt: new Date() });
    const body = { age: 28, heightCm: 152.4, weightKg: 72.5, gender: 'unspecified', goalIntention: 'maintain',
      healthyEatingFrequency: 'most_of_the_time', exerciseFrequency: 'once_or_twice', wakeTime: '07:00', sleepTime: '00:30' };
    const response = await request(app.getHttpServer()).post('/v1/accounts/onboarding')
      .set('Authorization', 'Bearer test-token').send(body).expect('Cache-Control', 'no-store').expect(200);
    expect(response.body).toMatchObject({ id: user.id, onboardingCompleted: true });
    expect(completeOnboarding).toHaveBeenCalledWith(user.id, body);
    await request(app.getHttpServer()).post('/v1/accounts/onboarding')
      .set('Authorization', 'Bearer test-token').send({ ...body, userId: 'spoofed' }).expect(400);
    expect(completeOnboarding).toHaveBeenCalledOnce();
    await request(app.getHttpServer()).post('/v1/accounts/onboarding').send(body).expect(401);
  });

  it('/health reports readiness after querying the database', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect('Cache-Control', 'no-store')
      .expect(200)
      .expect({ status: 'ok', database: 'up' });
    expect(query).toHaveBeenCalledOnce();
  });

  it('/health returns 503 without exposing database errors', async () => {
    query.mockRejectedValueOnce(new Error('sensitive database credentials'));
    await request(app.getHttpServer())
      .get('/health')
      .expect('Cache-Control', 'no-store')
      .expect(503)
      .expect({ status: 'error', database: 'down' });
  });

  it('/health/live stays healthy during a database outage', async () => {
    query.mockRejectedValueOnce(new Error('database unavailable'));
    await request(app.getHttpServer())
      .get('/health/live')
      .expect('Cache-Control', 'no-store')
      .expect(200)
      .expect({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('POST /v1/accounts creates a normalized member', async () => {
    await request(app.getHttpServer())
      .post('/v1/accounts')
      .send({
        email: '  Nishchay@Example.com  ',
        password: 'Test-password-123',
        timezone: 'Asia/Kolkata',
      })
      .expect(201)
      .expect({
        id: 'c115c629-d911-42aa-8e51-4a7d6db658ed',
        name: null,
        email: 'nishchay@example.com',
        timezone: 'Asia/Kolkata',
        accountStatus: 'member',
        onboardingCompleted: false,
      });
  });

  it('POST /v1/accounts creates a guest when email is omitted', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/accounts')
      .send({ timezone: 'UTC' })
      .expect(201);
    expect(response.body).toMatchObject({
      email: null,
      accountStatus: 'guest',
      onboardingCompleted: false,
    });
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { timezone: 'UTC', name: null },
    { timezone: 'UTC', name: '' },
    { timezone: 'UTC', name: '   ' },
    { timezone: 'UTC', name: 123 },
    { timezone: null },
    { timezone: 123 },
    { timezone: 'Asia/Unknown' },
    { timezone: 'UTC', email: null },
    { timezone: 'UTC', email: 123 },
    { timezone: 'UTC', email: 'invalid' },
    { timezone: 'UTC', email: '' },
    { timezone: 'UTC', email: 'a@example.com' },
    { timezone: 'UTC', email: 'a@example.com', password: null },
    { timezone: 'UTC', email: 'a@example.com', password: 123 },
    { timezone: 'UTC', email: 'a@example.com', password: 'short' },
    { timezone: 'UTC', password: 'Test-password-123' },
    { timezone: 'UTC', authProviderId: 'untrusted' },
    { timezone: 'UTC', accountStatus: 'member' },
    { timezone: 'UTC', onboardingCompletedAt: '2026-10-04' },
  ])('POST /v1/accounts rejects invalid input %j', async (body) => {
    await request(app.getHttpServer())
      .post('/v1/accounts')
      .send(body)
      .expect(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('POST /v1/accounts maps both pre-check and concurrent conflicts to 409', async () => {
    findByEmail.mockResolvedValueOnce({ id: 'existing' });
    const first = await request(app.getHttpServer())
      .post('/v1/accounts')
      .send({
        email: 'a@example.com',
        password: 'Test-password-123',
        timezone: 'UTC',
      })
      .expect(409);
    expect(first.body.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(create).not.toHaveBeenCalled();
    create.mockRejectedValueOnce(
      new ConflictError(
        'EMAIL_ALREADY_EXISTS',
        'An account with this email already exists',
      ),
    );
    const second = await request(app.getHttpServer())
      .post('/v1/accounts')
      .send({
        email: 'a@example.com',
        password: 'Test-password-123',
        timezone: 'UTC',
      })
      .expect(409);
    expect(second.body.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('signs in with normalized email and rejects incorrect credentials returning the stored credential as a bearer token', async () => {
    const email = 'a@example.com';
    const password = 'Test-password-123';
    const signup = await request(app.getHttpServer())
      .post('/v1/accounts')
      .send({ email, password, timezone: 'UTC' })
      .expect(201);
    expect(signup.body).not.toHaveProperty('authProviderId');
    expect(signup.body).not.toHaveProperty('password');
    const stored = create.mock.calls[0][0];
    expect(stored.passwordHash).toMatch(/^\$scrypt\$/);
    findCredentialsByEmail.mockResolvedValue({
      authProviderId: stored.authProviderId,
      passwordHash: stored.passwordHash,
      user: { ...stored, id: signup.body.id, onboardingCompletedAt: null },
    });
    await request(app.getHttpServer())
      .post('/v1/accounts/sign-in')
      .send({ email: ' A@EXAMPLE.COM ', password })
      .expect(200)
      .expect({
        ...signup.body,
        token: stored.authProviderId,
        tokenType: 'Bearer',
      });
    await request(app.getHttpServer())
      .post('/v1/accounts/sign-in')
      .send({ email, password: 'Wrong-password-123' })
      .expect(401)
      .expect({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    findCredentialsByEmail.mockResolvedValue(null);
    await request(app.getHttpServer())
      .post('/v1/accounts/sign-in')
      .send({ email: 'unknown@example.com', password })
      .expect(401)
      .expect({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
  });

  it.each([
    {},
    { email: 'a@example.com' },
    { email: 'invalid', password: 'Test-password-123' },
    { email: 'a@example.com', password: null },
    { email: 'a@example.com', password: 'short' },
  ])('rejects malformed sign-in input %j', async (body) => {
    await request(app.getHttpServer())
      .post('/v1/accounts/sign-in')
      .send(body)
      .expect(400);
  });

  it('creates and signs in the requested readable test credentials', async () => {
    const signup = await request(app.getHttpServer())
      .post('/v1/accounts')
      .send({
        name: 'test',
        email: 'test@email.com',
        password: 'test123',
        timezone: 'Asia/Kolkata',
      })
      .expect(201);
    expect(signup.body).toMatchObject({
      name: 'test',
      email: 'test@email.com',
    });
    const stored = create.mock.calls[0][0];
    findCredentialsByEmail.mockResolvedValue({
      authProviderId: stored.authProviderId,
      passwordHash: stored.passwordHash,
      user: { ...stored, id: signup.body.id, onboardingCompletedAt: null },
    });
    await request(app.getHttpServer())
      .post('/v1/accounts/sign-in')
      .send({ email: 'test@email.com', password: 'test123' })
      .expect(200)
      .expect({
        ...signup.body,
        token: stored.authProviderId,
        tokenType: 'Bearer',
      });
  });

  it('continue-as-guest creates a nameless guest with a UUID bearer token', async () => {
    const guest = await request(app.getHttpServer())
      .post('/v1/accounts/continue-as-guest')
      .send({ timezone: 'UTC' })
      .expect(201);
    expect(guest.body).toMatchObject({
      name: null,
      email: null,
      accountStatus: 'guest',
      timezone: 'UTC',
      onboardingCompleted: false,
      tokenType: 'Bearer',
    });
    expect(guest.body.auth_provider_id).toBe(guest.body.token);
    expect(guest.body.token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(create).toHaveBeenCalledWith({
      name: null,
      email: null,
      accountStatus: 'guest',
      timezone: 'UTC',
      authProviderId: guest.body.token,
      passwordHash: null,
    });
  });

  it('continue-as-guest defaults timezone and issues distinct tokens', async () => {
    const first = await request(app.getHttpServer())
      .post('/v1/accounts/continue-as-guest')
      .send({})
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/v1/accounts/continue-as-guest')
      .send({})
      .expect(201);
    expect(first.body.timezone).toBe('Asia/Kolkata');
    expect(first.body.token).not.toBe(second.body.token);
  });

  it.each([
    { timezone: null },
    { timezone: 'Asia/Unknown' },
    { name: 'test' },
    { email: 'test@email.com' },
  ])('continue-as-guest rejects invalid input %j', async (body) => {
    await request(app.getHttpServer())
      .post('/v1/accounts/continue-as-guest')
      .send(body)
      .expect(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('create-account converts a guest using its auth provider UUID', async () => {
    const guest = await request(app.getHttpServer())
      .post('/v1/accounts/continue-as-guest')
      .send({})
      .expect(201);
    registerGuest.mockImplementation(async (input) => ({
      ...input,
      id: guest.body.id,
      accountStatus: 'member',
      onboardingCompletedAt: null,
    }));
    const member = await request(app.getHttpServer())
      .post('/v1/accounts')
      .send({
        auth_provider_id: guest.body.auth_provider_id,
        name: 'guest test',
        email: 'guest@email.com',
        password: 'test123',
        timezone: 'UTC',
      })
      .expect(201);
    expect(member.body).toMatchObject({
      id: guest.body.id,
      name: 'guest test',
      email: 'guest@email.com',
      accountStatus: 'member',
    });
    expect(create).toHaveBeenCalledTimes(1);
    const converted = registerGuest.mock.calls[0][0];
    expect(converted.authProviderId).toBe(guest.body.token);
    expect(converted.passwordHash).toMatch(/^\$scrypt\$/);
    findCredentialsByEmail.mockResolvedValue({
      user: { ...member.body, onboardingCompletedAt: null },
      authProviderId: guest.body.token,
      passwordHash: converted.passwordHash,
    });
    const signedIn = await request(app.getHttpServer())
      .post('/v1/accounts/sign-in')
      .send({ email: 'guest@email.com', password: 'test123' })
      .expect(200);
    expect(signedIn.body.token).toBe(guest.body.token);
  });

  afterEach(async () => {
    await app.close();
  });
});
