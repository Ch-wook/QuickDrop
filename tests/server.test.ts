import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/app';
import { config } from '../server/config';
import type { ServerSignal } from '../shared/protocol';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllEnvs(); });
async function setup(roomTtl = 10000) {
  const app = createApp({ ...config, roomTtl, publicUrl: '', trustProxy: 0 });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  cleanups.push(app.close);
  const create = () => fetch(`${origin}/api/rooms`, { method: 'POST', headers: { origin } });
  const connect = async (requestedOrigin = origin) => {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { origin: requestedOrigin });
    const messages: ServerSignal[] = [];
    ws.on('message', data => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return { ws, messages, send: (message: unknown) => ws.send(JSON.stringify(message)) };
  };
  return { ...app, origin, create, connect };
}
describe('HTTP and WebSocket integration', () => {
  it('keeps temporary invitation pages and APIs out of search results', async () => {
    const runtime = await setup();
    runtime.app.get(['/', '/join/:roomId'], (_req, res) => res.type('html').send('<h1>QuickDrop</h1>'));
    const home = await fetch(runtime.origin);
    expect(home.headers.get('x-robots-tag')).toBeNull();
    for (const url of ['/join/private-room', '/JOIN/private-room', '/api/config']) {
      const response = await fetch(`${runtime.origin}${url}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    }
    const head = await fetch(`${runtime.origin}/join/private-room`, { method: 'HEAD' });
    expect(head.headers.get('x-robots-tag')).toContain('noindex');
  });
  it('rejects unknown production upgrade paths and closes cleanly', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const app = await setup();
    const ws = new WebSocket(`${app.origin.replace('http:', 'ws:')}/not-ws`, { origin: app.origin });
    const rejection = new Promise<string>(resolve => ws.once('error', error => resolve(error.message)));
    const closed = new Promise<void>(resolve => ws.once('close', () => resolve()));
    expect(await rejection).toContain('404');
    await closed;
    const first = app.close();
    expect(app.close()).toBe(first);
    await first;
  });
  it('bounds shutdown even when an HTTP response never finishes', async () => {
    const app = await setup();
    app.app.get('/unfinished', (_req, res) => { res.write('waiting'); });
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(`${app.origin}/unfinished`, response => {
        response.on('error', () => {}); response.resume(); resolve();
      });
      request.on('error', reject); request.end();
    });
    await app.close();
    expect(app.server.listening).toBe(false);
  }, 10000);
  it('serves uncached temporary TURN credentials without disclosing the shared secret', async () => {
    const secret = 'test-shared-secret-with-at-least-32-characters';
    const runtime = createApp({ ...config, publicUrl: '', turnSecret: secret, iceServers: [{ urls: ['turn:relay.example.com:3478'], username: undefined, credential: undefined }] });
    await new Promise<void>(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
    cleanups.push(runtime.close);
    const origin = `http://127.0.0.1:${(runtime.server.address() as { port: number }).port}`;
    const response = await fetch(`${origin}/api/config`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const data = await response.json();
    expect(JSON.stringify(data)).not.toContain(secret);
    expect(data).not.toHaveProperty('turnSecret');
    expect(data.iceServers[0].username).toMatch(/^\d+:[a-f0-9-]+$/);
    const second = await (await fetch(`${origin}/api/config`)).json();
    expect(second.iceServers[0].credential).not.toBe(data.iceServers[0].credential);
  });
  it('limits configuration requests that can issue relay credentials', async () => {
    const app = await setup();
    for (let i = 0; i < 120; i++) expect((await fetch(`${app.origin}/api/config`)).status).toBe(200);
    expect((await fetch(`${app.origin}/api/config`)).status).toBe(429);
  });
  it('creates rooms only from the same origin', async () => {
    const app = await setup();
    expect((await app.create()).status).toBe(201);
    expect((await fetch(`${app.origin}/api/rooms`, { method: 'POST', headers: { origin: 'https://evil.example' } })).status).toBe(403);
    await expect(app.connect('https://evil.example')).rejects.toThrow();
  });
  it('redirects local page URLs to PUBLIC_URL, preserving a join path without redirecting API calls', async () => {
    const runtime = createApp({ ...config, publicUrl: 'https://drop.example.com', trustProxy: 1 });
    await new Promise<void>(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
    cleanups.push(runtime.close);
    const address = runtime.server.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    const join = `/join/${'a'.repeat(32)}`;
    const response = await fetch(`${origin}${join}`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`https://drop.example.com${join}`);
    expect((await fetch(`${origin}/api/health`)).status).toBe(200);
    // Node fetch normalizes Host; use HTTP directly to emulate proxy headers.
    const secureStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(origin, { headers: { host: 'drop.example.com', 'x-forwarded-proto': 'https' } }, response => {
        response.resume(); resolve(response.statusCode);
      });
      request.once('error', reject); request.end();
    });
    expect(secureStatus).toBe(404);
  });
  it('exchanges offer/answer/ICE only within a two-peer room and notifies departure', async () => {
    const app = await setup(); const room = await (await app.create()).json();
    const a = await app.connect(); a.send({ type: 'JOIN', roomId: room.roomId, ownerToken: room.ownerToken });
    await expect.poll(() => a.messages.map(m => m.type)).toContain('JOINED');
    const b = await app.connect(); b.send({ type: 'JOIN', code: room.code });
    await expect.poll(() => b.messages.map(m => m.type)).toContain('PEER_JOINED');
    expect(a.messages).toContainEqual({ type: 'PEER_JOINED', initiator: true });
    expect(b.messages).toContainEqual({ type: 'PEER_JOINED', initiator: false });
    a.send({ type: 'OFFER', sdp: 'offer' }); b.send({ type: 'ANSWER', sdp: 'answer' });
    a.send({ type: 'ICE_CANDIDATE', candidate: { candidate: 'candidate:1', sdpMid: '0' } });
    await expect.poll(() => b.messages.map(m => m.type)).toContain('ICE_CANDIDATE');
    expect(b.messages).toContainEqual({ type: 'OFFER', sdp: 'offer' });
    await expect.poll(() => a.messages.map(m => m.type)).toContain('ANSWER');
    const c = await app.connect(); c.send({ type: 'JOIN', code: room.code });
    await expect.poll(() => c.messages.map(m => m.type)).toContain('ERROR');
    b.ws.close(); await expect.poll(() => a.messages.map(m => m.type)).toContain('PEER_LEFT');
    a.ws.close(); await expect.poll(() => app.rooms.rooms.size).toBe(0);
  });
  it('rejects content sent to the signaling server', async () => {
    const app = await setup(); const peer = await app.connect();
    peer.send({ type: 'TEXT', text: 'must never be relayed' });
    await expect.poll(() => peer.messages.map(m => m.type)).toContain('ERROR');
    await expect.poll(() => peer.ws.readyState).toBe(WebSocket.CLOSED);
  });
  it('notifies a waiting peer when the room expires', async () => {
    const app = await setup(250); const room = await (await app.create()).json(); const peer = await app.connect();
    peer.send({ type: 'JOIN', roomId: room.roomId, ownerToken: room.ownerToken });
    await expect.poll(() => peer.messages.map(m => m.type)).toContain('ROOM_EXPIRED');
  });
  it('rate limits room creation', async () => {
    const app = await setup();
    for (let i = 0; i < 30; i++) expect((await app.create()).status).toBe(201);
    expect((await app.create()).status).toBe(429);
  });
  it('blocks repeated code guessing across different sockets from the same IP', async () => {
    const app = await setup();
    for (let i = 0; i < 11; i++) {
      const peer = await app.connect(); peer.send({ type: 'JOIN', code: '000000' });
      await expect.poll(() => peer.messages.map(m => m.type)).toContain('ERROR');
      if (i === 10) expect(peer.messages).toContainEqual({ type: 'ERROR', message: '연결 시도가 너무 많습니다. 1분 후 다시 시도하세요.' });
    }
  });
});
