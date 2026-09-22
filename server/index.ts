import express from 'express';
import path from 'node:path';
import { config } from './config';
import { createApp } from './app';

process.env.NODE_ENV ??= process.argv[1]?.replaceAll('\\', '/').includes('/dist/server/') ? 'production' : 'development';
const runtime = createApp(config);
let closeVite: (() => Promise<void>) | undefined;
if (process.env.NODE_ENV !== 'production') {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: { server: runtime.server }, hmr: { server: runtime.server } }, appType: 'spa' });
  runtime.app.use(vite.middlewares);
  closeVite = () => vite.close();
} else {
  const root = path.resolve('dist/client');
  runtime.app.use(express.static(root, { index: false }));
  runtime.app.get(['/', '/join/:roomId'], (_req, res) => res.sendFile(path.join(root, 'index.html')));
}
runtime.server.listen(config.port, config.host, () => console.log(`QuickDrop: ${config.publicUrl || `http://localhost:${config.port}`}`));
async function shutdown() { await closeVite?.(); await runtime.close(); process.exit(0); }
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
