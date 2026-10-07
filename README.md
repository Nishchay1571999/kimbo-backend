# Kimbo backend

NestJS backend with Prisma ORM 7.10 and Supabase PostgreSQL.

## Setup

Requires Node.js 20.19+ (or a supported newer LTS) and pnpm 10.

1. Copy `.env.example` to `.env` and fill in the connection strings from the Supabase Connect panel. URL-encode special characters in the database password.
2. Run `pnpm install` to install dependencies and generate Prisma Client.
3. Run `pnpm run db:check` to build and check both connections with read-only queries.
4. Run `pnpm run start:dev` to start the API.

Environment variables supplied by the hosting platform take precedence over `.env`. Keep the real env files out of source control.

Docker copies the same `.env` into `/app` for Prisma generation, migration commands, and NestJS runtime configuration. No separate environment file is needed. The image contains these credentials; keep it in a private registry and rebuild it after changing `.env`. The container starts the compiled application with `pnpm run start:prod`.

## Database connections

`DATABASE_URL` is used by the application, through Supabase's transaction pooler on port **6543**. `DIRECT_URL` is used by the Prisma CLI, through the session pooler on port **5432**, which works on IPv4 networks. Despite its variable name, this is a session pooler URL, not Supabase's IPv6 direct endpoint. See the [Supabase Prisma guide](https://supabase.com/docs/guides/database/prisma).

The example uses `sslmode=require&uselibpqcompat=true`, which requires encrypted TLS but does **not** verify the server certificate. This accommodates Supabase's private certificate authority. For production, download the CA certificate from Supabase Dashboard → Database Settings and replace the query parameters in both URLs with `sslmode=verify-full&sslrootcert=./certs/supabase-ca.crt`. Provision that file at the same path on the host; URL-encode paths containing special characters. See [Supabase SSL configuration](https://supabase.com/docs/guides/database/connecting-to-postgres#ssl).

`PrismaModule` exports one `PrismaService` per Nest application. It uses the PostgreSQL driver adapter with a maximum of five connections, a ten-second connection timeout, a five-second client query timeout, and a thirty-second idle timeout. Startup performs `SELECT 1` so invalid credentials fail immediately. Application shutdown closes the pool. The client query timeout limits how long the client waits; it does not guarantee server-side query cancellation. Adjust it if future workloads need longer queries.

## Health checks

- `GET /health/live` returns HTTP 200 with `{ "status": "ok" }` when the HTTP server is running. It does not query the database, so a database outage does not trigger liveness restarts.
- `GET /health` executes a read-only `SELECT 1` through the shared Prisma client. It returns HTTP 200 with `{ "status": "ok", "database": "up" }`, or HTTP 503 with `{ "status": "error", "database": "down" }`. It never returns driver errors or credentials. Both endpoints disable response caching.
- `pnpm run health:check` builds, starts a temporary real Nest server on an available loopback port, checks both endpoints against Supabase, then shuts down the server and pool.

Use `/health/live` for liveness and `/health` for readiness in hosting or container probes. Startup still requires a successful database connection.

Import `PrismaModule` into a feature module and inject `PrismaService`. Use `prisma.client` for queries. For example, in an injected service method:

```ts
const result = await this.prisma.client.$queryRaw`SELECT 1 AS ok`;
```

Do not create additional Prisma clients per request. Use tagged raw queries for parameterized SQL.

## Schema and migrations

The schema defines the nine-table health model described in [the database contract](docs/database-schema.md). Checked-in migrations include SQL constraints and triggers for ownership, revisions and append-only observations. Use `pnpm run prisma:deploy` to install these migrations; client generation alone does not apply them.

```bash
# Validate the schema
pnpm run prisma:validate

# After adding models, create and apply a development migration
pnpm run prisma:migrate --name init

# Regenerate after schema changes (Prisma 7 migrations do not do this automatically)
pnpm run prisma:generate

# Inspect migration status
pnpm run prisma:status

# Apply committed migrations during deployment
pnpm run prisma:deploy

# Browse the database
pnpm run prisma:studio
```

Use `prisma:migrate` against a development database. Prisma's development migration workflow may need a separate shadow database; never use the production database as the shadow database. Use `prisma:deploy` for production and commit `prisma/migrations` alongside schema changes. Avoid `db push` for production migration management.

Client code is generated into `src/generated/prisma`, ignored by Git, and compiled into `dist/generated/prisma`. `pnpm run build` regenerates the client before compiling. Import the generated client through `src/generated/prisma/client.js` rather than `@prisma/client`.

## Checks and production startup

```bash
pnpm run prisma:validate
pnpm exec tsc --noEmit
pnpm run lint
pnpm test
pnpm run test:e2e
pnpm run db:check
pnpm run health:check

pnpm run build
pnpm run start:prod
```

Unit and HTTP tests do not require live database access; the HTTP test replaces `PrismaService`. `db:check` is the explicit live integration check and never changes database data or schema. It tests both env URLs and reports connection errors without printing credentials.

## Accounts, guests, and sign-in

`POST /v1/accounts/onboarding` requires the account's bearer token and accepts
`age`, `heightCm`, `weightKg`, `gender`, `goalIntention`, `healthyEatingFrequency`,
`exerciseFrequency`, `wakeTime` and `sleepTime`. Lifestyle enum values use
underscores; schedule values use 24-hour `HH:mm` in the account's timezone.
Unknown fields are rejected, and overnight sleep is supported. It returns HTTP
200 with the public account and `onboardingCompleted: true`.

The profile, initial weight observation and completion flag commit in one
transaction. A user row lock serializes submissions; retries after completion
return the existing account without overwriting facts or adding weight records.
An existing incomplete profile returns 409 `ONBOARDING_PROFILE_EXISTS`.
No schema migration is required for this endpoint.

`GET /v1/accounts/me` requires a bearer token and returns the public account
fields, including `onboardingCompleted`. It works before onboarding completion,
does not use the development identity stub, and never returns tokens or password
hashes. Invalid or missing credentials return HTTP 401 `INVALID_SESSION`.

Set `CORS_ORIGINS` to a comma-separated list of allowed web app origins. The
default permits local Expo web origins on ports 8081 and 19006; production web
origins must be configured explicitly.

`POST /v1/accounts/continue-as-guest` accepts `{}` or an optional IANA `timezone`.
It creates a guest with null name, email and password hash, incomplete onboarding,
and a random UUID `auth_provider_id`. Timezone defaults to `Asia/Kolkata`.
The HTTP 201 response contains account fields plus `auth_provider_id`, `token` (the same UUID), and `tokenType: "Bearer"`.
Store that token to identify the guest during registration.

`POST /v1/accounts` creates a member with email and password. Email is trimmed and
lowercased; password is preserved exactly and must contain 7–128 characters.
Optional name is trimmed and must contain 1–100 characters when provided.
Timezone is required and must be a valid IANA name such as `Asia/Kolkata` or `UTC`.

Include the guest token as `auth_provider_id` (or camelCase `authProviderId`) to convert the existing guest:

```json
{
  "auth_provider_id": "guest-uuid-from-response",
  "name": "guest test",
  "email": "guest-test@email.com",
  "password": "test123",
  "timezone": "Asia/Kolkata"
}
```

Conversion updates that guest in place, sets member status and stores the
email/password hash. Its user ID, UUID token, onboarding and owned rows are
preserved. An occupied normalized email returns HTTP 409 `EMAIL_ALREADY_EXISTS`,
including database uniqueness races. A missing or already-converted guest returns
HTTP 401 `INVALID_GUEST_TOKEN`; a member cannot be overwritten using this flow.
Unknown request fields and malformed UUIDs are rejected. The existing account
creation behavior with omitted email/password remains available, but the dedicated
guest endpoint returns the token needed for later conversion.

Credential hashes live in `users.password_hash`; tokens live in
`users.auth_provider_id`. New accounts receive UUID tokens, while migration
preserves existing tokens and backfills existing scrypt credentials. Password
hashes and plaintext passwords are excluded from account responses.

`POST /v1/accounts/sign-in` accepts email and password, verifies `password_hash`,
and returns the public account fields plus `token` (the unchanged auth provider
value) and `tokenType: "Bearer"`. The client can send
`Authorization: Bearer <token>` on subsequent requests. Unknown accounts and
incorrect passwords return HTTP 401 `INVALID_CREDENTIALS`. Bearer validation must
be applied to protected product routes. Tokens currently have no expiry or
revocation. No external identity provider or email verification is used.

Invalid input returns HTTP 400. Business validation codes include `INVALID_EMAIL`,
`INVALID_PASSWORD`, `INVALID_NAME`, `EMAIL_REQUIRED` and `INVALID_TIMEZONE`.
Unexpected database errors return HTTP 500 without exposing database details.
Onboarding remains a separate transaction.

The identity feature wires controller → use case → repository contract → Prisma
adapter. Use cases have no Prisma dependency. Credential hashing has its own
small port and scrypt adapter. Shared database lifecycle code lives in
`src/common/database`. Unit and HTTP tests cover validation, hashing, guest
conversion, sign-in and error mapping; live checks use the configured `.env` DB.

## Product APIs

Entries CRUD, USDA and Open Food Facts search/portion calculation, Home aggregation and the revision-safe
AI worker are implemented. See [the product API contract](docs/product-api.md) for
request examples, local test identity, Home semantics and provider configuration.
Run `pnpm run product:check` for the opt-in live flow check against `test@email.com`;
it creates and soft-deletes its own test entries.

Run `pnpm run test:seed --date=2026-10-05` to populate the existing
`test@email.com` account with dummy onboarding, three weeks of meals/exercise,
five weight measurements, and three sample conversations. The seed reuses entry
validation, repositories, Home calculations, and the shared Prisma client. It
commits atomically, skips existing fixtures on reruns for the same date, preserves
passwords/tokens and existing profile values, and does not invoke AI. Without
`--date`, it uses the account's current local date. All meals and thread titles
are marked `[Dummy]`; assistant metadata marks replies and retrieval snapshots
as simulated, with no actual-model attribution. Entry analysis is not requested.
The generated summary is saved to `docs/test-account-seed-verification.json`.

Daily goals: `GET/PUT /v1/goals/target` suggest and store a user-confirmed
calorie and protein target. Home's `goal` block and `/v1/home/week` compare each
day with it using deterministic rules (see the product API contract), and the
chat context receives the same server-computed numbers so the assistant explains
days relative to the goal instead of restating totals. Model selection is hidden
from the main app flow ("Auto" = the server default with one registered fallback);
each reply still records `actual_model_id`, which the app shows under a message's
Details together with its sources.

Chat threads, durable messages, read-only health tools, source snapshots and
NDJSON streaming are implemented using the existing tables and OpenRouter Agent
SDK. See [the chat API contract](docs/chat-api.md) for request/event examples,
pagination, idempotency and failure behavior.

Run `pnpm run chat:check` for the opt-in live PostgreSQL/OpenRouter flow check,
always using `test@email.com`. It creates verification threads, calls the real
agent, checks streaming/replay/retrieval, and injects controlled failures and
cancellation. Results are saved to `docs/chat-flow-verification.json`.
Run `pnpm run chat:check-availability` for the smaller read-only availability,
Home/Entries consistency and dummy-source provenance check; it saves
`docs/chat-live-verification.json`. Cross-user access uses isolated HTTP tests,
not another live account.

Run `pnpm run chat:check-deployed` to verify the Fly deployment using the same
test account. It checks API authentication, USDA search, thread pagination,
real OpenRouter retrieval, persisted sources and retries, then soft-deletes
its temporary verification thread. Fly supplies runtime credentials as secrets;
local environment files are excluded from the Docker image.

`pnpm run ai:configure --test-chat-primary=google/gemini-3.8-flash` registers
models from OpenRouter's live catalog and updates only the test account's chat
preference. Existing entry model selection is preserved. `CHAT_DEFAULT_MODEL`
defaults to Gemini 3.8 Flash when registered; `CHAT_FALLBACK_MODEL` defaults to
registered GPT-5.4 Mini (an empty value disables fallback). Model
capability and provider privacy/routing settings can affect tool availability;
an unavailable provider route produces a classified failed assistant message.

Open Food Facts uses the same Nutrition APIs with `provider=open-food-facts`.
Run `pnpm run nutrition:check-off` for the live barcode/search/entry/Home check.
