import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, request } from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mountStatic } from '../server/static';

const execute = promisify(execFile);
const app = express();
const server = createServer(app);
const source = 'console.log("compressed asset");\n'.repeat(100);
const filename = 'index-AbCd1234.js';
let directory: string;
let origin: string;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'quickdrop-static-'));
  await mkdir(path.join(directory, 'assets'));
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><title>QuickDrop</title>');
  await writeFile(path.join(directory, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(path.join(directory, 'assets', filename), source);
  await writeFile(path.join(directory, 'assets', 'tiny-AbCd1234.js'), '1');
  await writeFile(path.join(directory, '.secret'), 'hidden');
  await execute(process.execPath, ['scripts/compress-assets.mjs', path.join(directory, 'assets')]);
  mountStatic(app, directory);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (directory) {
    const target = path.resolve(directory);
    if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('quickdrop-static-')) throw new Error('Invalid test cleanup path');
    await rm(target, { recursive: true, force: true });
  }
});

function get(url: string, encoding?: string, method = 'GET', extra: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = request(origin + url, { method, headers: { ...(encoding === undefined ? {} : { 'accept-encoding': encoding }), ...extra } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}

describe('production asset delivery', () => {
  it('serves Brotli bytes with the original MIME and immutable cache', async () => {
    const result = await get(`/assets/${filename}`, 'br, gzip');
    expect(result.status).toBe(200);
    expect(result.headers['content-encoding']).toBe('br');
    expect(result.headers['content-type']).toContain('javascript');
    expect(result.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(result.headers.vary).toContain('Accept-Encoding');
    expect(brotliDecompressSync(result.body).toString()).toBe(source);
  });
  it('honors encoding quality and falls back to identity', async () => {
    const gzip = await get(`/assets/${filename}`, 'gzip;q=1, br;q=0.5');
    expect(gzip.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gzip.body).toString()).toBe(source);
    for (const encoding of [undefined, 'br;q=0, gzip;q=0', 'identity']) {
      const result = await get(`/assets/${filename}`, encoding);
      expect(result.headers['content-encoding']).toBeUndefined();
      expect(result.body.toString()).toBe(source);
    }
  });
  it('does not cache an unacceptable encoding response', async () => {
    const result = await get(`/assets/${filename}`, '*;q=0');
    expect(result.status).toBe(406);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers.vary).toContain('Accept-Encoding');
  });
  it('supports HEAD and representation-specific revalidation', async () => {
    const body = await get(`/assets/${filename}`, 'br');
    const head = await get(`/assets/${filename}`, 'br', 'HEAD');
    expect(head.body.length).toBe(0);
    expect(head.headers['content-length']).toBe(String(body.body.length));
    const cached = await get(`/assets/${filename}`, 'br', 'GET', { 'if-none-match': body.headers.etag! });
    expect(cached.status).toBe(304);
    const identity = await get(`/assets/${filename}`, 'identity', 'GET', { 'if-none-match': body.headers.etag! });
    expect(identity.status).toBe(200);
  });
  it('revalidates HTML entrypoints after a deployment', async () => {
    for (const url of ['/', '/join/room', '/index.html']) {
      const result = await get(url);
      expect(result.status).toBe(200);
      expect(result.headers['cache-control']).toBe('no-cache');
      expect(result.body.toString()).toContain('QuickDrop');
    }
    expect((await get('/favicon.svg')).headers['cache-control']).toBe('public, max-age=3600');
  });
  it('keeps tiny assets uncompressed and blocks private or missing paths', async () => {
    expect((await get('/assets/tiny-AbCd1234.js', 'br, gzip')).body.toString()).toBe('1');
    for (const url of [`/assets/${filename}.br`, '/assets/missing.js', '/.secret', '/assets/%2e%2e%2f.secret']) {
      expect((await get(url, 'br')).status).toBe(404);
    }
    expect((await get('/assets/%ZZ')).status).toBe(400);
  });
});
