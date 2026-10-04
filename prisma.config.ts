import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Supabase session pooler (5432), rather than transaction pooler (6543).
    url: env('DIRECT_URL'),
  },
});
