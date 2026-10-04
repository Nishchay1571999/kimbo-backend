# Kimbo backend

NestJS backend with Prisma ORM 7.10 and Supabase PostgreSQL.

## Setup

Requires Node.js 20.19+ (or a supported newer LTS) and pnpm 10.

1. Copy `.env.example` to `.env` and fill in the connection strings from the Supabase Connect panel. URL-encode special characters in the database password.
2. Run `pnpm install` to install dependencies and generate Prisma Client.
3. Run `pnpm run db:check` to build and check both connections with read-only queries.
4. Run `pnpm run start:dev` to start the API.

Environment variables supplied by the hosting platform take precedence over `.env`. Keep the real env files out of source control.

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

The connected database currently has no application tables in `public`, so the schema intentionally has no domain models and no migration has been applied. Prisma Client still generates and supports raw queries. Add models when the application's domain is defined.

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
