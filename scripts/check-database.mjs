import 'dotenv/config';
import { createPrismaClient } from '../dist/common/database/prisma-client.js';

let failed = false;
for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const connectionString = process.env[name];
  if (!connectionString) {
    console.error(`${name}: missing`);
    failed = true;
    continue;
  }

  let prisma;
  try {
    prisma = createPrismaClient(connectionString);
    const [result] = await prisma.$queryRaw`
      SELECT current_database() AS database, current_schema() AS schema,
             (SELECT count(*)::int FROM information_schema.tables
              WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS public_tables
    `;
    console.log(`${name}: connected`, result);
  } catch (error) {
    // Do not print connection URLs, credentials, or driver error objects.
    const cause = error?.meta?.driverAdapterError?.cause;
    const code = error?.code ?? error?.cause?.code;
    const hints = {
      TlsConnectionError:
        'TLS verification failed; supply the Supabase CA using sslrootcert in the URL.',
      AuthenticationFailed:
        'Supabase rejected the credentials; check the database password and URL encoding.',
      DatabaseNotReachable:
        'Check the Supabase project status, hostname, port, and network access.',
    };
    console.error(`${name}: connection failed${code ? ` (${code})` : ''}`);
    if (cause?.kind && hints[cause.kind]) console.error(hints[cause.kind]);
    failed = true;
  } finally {
    await prisma?.$disconnect();
  }
}
process.exitCode = failed ? 1 : 0;
