import { config } from './config';
import { createApp } from './app';
import { mountStatic } from './static';

process.env.NODE_ENV ??= process.argv[1]?.replaceAll('\\', '/').includes('/dist/server/') ? 'production' : 'development';
const runtime = createApp(config);
let closeVite: (() => Promise<void>) | undefined;
if (process.env.NODE_ENV !== 'production') {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: { server: runtime.server }, hmr: { server: runtime.server } }, appType: 'spa' });
  runtime.app.use(vite.middlewares);
  closeVite = () => vite.close();
} else {
  mountStatic(runtime.app);
}
runtime.server.listen(config.port, config.host, () => console.log(`QuickDrop: ${config.publicUrl || `http://localhost:${config.port}`}`));
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await closeVite?.(); await runtime.close(); process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
