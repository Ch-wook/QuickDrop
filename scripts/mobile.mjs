import 'dotenv/config';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const stateDir = path.join(root, '.quickdrop');
const statePath = path.join(stateDir, 'mobile.json');
const port = Number(process.env.MOBILE_PORT || 3001);
const children = new Set();
let stopping = false;
let log;

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    if (state.pid === process.pid) await unlink(statePath);
  } catch { /* State may not have been written yet. */ }
  log?.end();
  process.exit(code);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

function start(command, args, env = process.env) {
  const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.once('error', error => { console.error(error.message); void shutdown(1); });
  child.once('exit', code => {
    children.delete(child);
    if (!stopping) { console.error(`A mobile session process stopped (${code ?? 'signal'}). Run npm run dev:mobile again.`); void shutdown(1); }
  });
  return child;
}

async function cloudflared() {
  const manifest = JSON.parse(await readFile(new URL('./cloudflared-release.json', import.meta.url), 'utf8'));
  const asset = manifest.assets[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error(`Unsupported platform: ${process.platform}-${process.arch}. Use an HTTPS reverse proxy and PUBLIC_URL instead.`);
  const directory = path.join(root, '.tools', `cloudflared-${manifest.version}-${process.platform}-${process.arch}`);
  await mkdir(directory, { recursive: true });
  const downloadPath = path.join(directory, asset.name);
  let bytes;
  try { bytes = await readFile(downloadPath); } catch { /* First run. */ }
  const checksum = value => createHash('sha256').update(value).digest('hex');
  if (!bytes || checksum(bytes) !== asset.sha256) {
    const url = `https://github.com/cloudflare/cloudflared/releases/download/${manifest.version}/${asset.name}`;
    console.log(`Downloading official cloudflared ${manifest.version} from github.com/cloudflare/cloudflared...`);
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`cloudflared download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (checksum(bytes) !== asset.sha256) throw new Error('cloudflared SHA-256 verification failed. The binary will not be executed.');
    await writeFile(downloadPath, bytes);
  }
  if (asset.name.endsWith('.tgz')) {
    await promisify(execFile)('tar', ['-xzf', downloadPath, '-C', directory, 'cloudflared']);
    return path.join(directory, 'cloudflared');
  }
  if (process.platform !== 'win32') await chmod(downloadPath, 0o755);
  return downloadPath;
}

async function availablePort() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MOBILE_PORT must be between 1 and 65535.');
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
}

async function run() {
  await availablePort();
  await mkdir(stateDir, { recursive: true });
  log = createWriteStream(path.join(stateDir, 'mobile.log'), { flags: 'w' });
  console.log('Starting a temporary public HTTPS test address through Cloudflare. Keep this process running.');
  const binary = await cloudflared();
  const tunnel = start(binary, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`]);
  const publicUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('HTTPS tunnel startup timed out. See .quickdrop/mobile.log.')), 60000);
    let output = '';
    const collect = data => {
      log.write(data);
      output = (output + data.toString()).slice(-10000);
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    };
    tunnel.stdout.on('data', collect); tunnel.stderr.on('data', collect);
  });
  // Only the production app is exposed. Vite sources/HMR are never tunneled.
  // One loopback tunnel hop supplies X-Forwarded-For and X-Forwarded-Proto.
  const app = start(process.execPath, ['dist/server/index.js'], {
    ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
    PUBLIC_URL: publicUrl, TRUST_PROXY: '1',
  });
  app.stdout.on('data', data => log.write(data)); app.stderr.on('data', data => log.write(data));
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${publicUrl}/api/config`, { signal: AbortSignal.timeout(5000) });
      if (response.ok && (await response.json()).publicUrl === publicUrl) {
        await writeFile(statePath, JSON.stringify({ publicUrl, localUrl: `http://127.0.0.1:${port}`, pid: process.pid, startedAt: new Date().toISOString() }, null, 2));
        console.log(`\nQuickDrop mobile is ready: ${publicUrl}\nOpen this HTTPS address on the PC, then scan its QR with your phone.\nLocal shortcut: http://127.0.0.1:${port} (redirects to HTTPS)\nCtrl+C stops the server and the tunnel. The address changes on each run.\n`);
        return;
      }
    } catch { /* Edge registration / DNS may take a few seconds. */ }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error('The public HTTPS address did not become reachable. See .quickdrop/mobile.log and check outbound network access.');
}

run().catch(error => { console.error(error.message); void shutdown(1); });
