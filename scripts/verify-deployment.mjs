import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Verify the public server serves this checkout's build, not merely a healthy
// previous deployment. Never print /api/config credentials.
try {
  const value = process.argv[2] || process.env.PUBLIC_URL;
  if (!value) throw new Error('Usage: npm run deploy:verify -- https://your-service.example');
  const base = new URL(value);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Provide a plain HTTPS origin.');
  const localHtml = await readFile('dist/client/index.html', 'utf8');
  const assets = [...localHtml.matchAll(/(?:src|href)="(\/assets\/[^"<>]+\.(?:js|css))"/g)].map(match => match[1]);
  if (!assets.length) throw new Error('Build assets were not found. Run npm run build first.');
  async function get(url, options = {}) {
    const response = await fetch(new URL(url, base), { redirect: 'error', signal: AbortSignal.timeout(15000), ...options });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response;
  }
  const health = await (await get('/api/health')).json();
  if (health.ok !== true) throw new Error('Health check failed.');
  const config = await (await get('/api/config')).json();
  if (config.publicUrl !== base.origin) throw new Error('PUBLIC_URL does not match the deployed origin.');
  const document = await get('/');
  const remoteHtml = await document.text();
  for (const asset of assets) {
    if (!remoteHtml.includes(`"${asset}"`)) throw new Error(`The public server is still serving a different build. Expected ${asset}.`);
    const relative = asset.slice(1);
    if (!relative.startsWith('assets/') || relative.includes('..')) throw new Error('Invalid build asset path.');
    const source = await readFile(path.join('dist/client', relative));
    const response = await get(asset, { headers: { 'accept-encoding': 'br, gzip' } });
    const received = Buffer.from(await response.arrayBuffer());
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    if (hash(received) !== hash(source)) throw new Error(`${asset}: content differs from the local build.`);
    if (!response.headers.get('cache-control')?.includes('immutable')) throw new Error(`${asset}: immutable cache is missing.`);
    if (source.length > 1024 && !['br', 'gzip'].includes(response.headers.get('content-encoding'))) throw new Error(`${asset}: compressed delivery is missing.`);
    console.log(`OK ${asset}: ${response.headers.get('content-encoding') || 'identity'}`);
  }
  if (!document.headers.get('cache-control')?.includes('no-cache')) throw new Error('HTML must revalidate after deployment.');
  console.log(`Verified current build at ${base.origin}. Run the public WebRTC E2E separately.`);
} catch (error) {
  console.error(`Deployment verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
