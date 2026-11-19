import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from './app.js';
import { MemoryStore, PgStore, type Store } from './store.js';

const port = Number(process.env.PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL;

const store: Store = databaseUrl ? await PgStore.connect(databaseUrl) : new MemoryStore();
const here = path.dirname(fileURLToPath(import.meta.url));
const { app } = await buildApp({
  store,
  staticDir: path.resolve(here, '../../web/dist'),
  logger: true,
});

const shutdown = async () => {
  await app.close();
  await store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
// A last line of defence: log a stray failed promise instead of letting Node exit on it. Saving and
// loading rooms handle their own failures; this is for anything missed.
process.on('unhandledRejection', (e) => app.log.error({ err: e }, 'unhandled rejection'));
process.on('SIGTERM', shutdown);

await app.listen({ port, host: '0.0.0.0' });
app.log.info(databaseUrl ? 'storage: Postgres' : 'storage: in memory (set DATABASE_URL for Postgres)');
