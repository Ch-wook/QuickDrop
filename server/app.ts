import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Rooms, RateLimiter } from './rooms';
import { signalSchema, type ServerSignal } from '../shared/protocol';
import type { Config } from './config';
import { clientIceServers } from './ice';

export function createApp(config: Config) {
  const app = express();
  const server = createServer(app);
  const rooms = new Rooms(config.roomTtl);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 40000, perMessageDeflate: false });
  const peers = new Map<string, { ws: WebSocket; roomId?: string; alive: boolean }>();
  const createLimit = new RateLimiter(30, 60000);
  const configLimit = new RateLimiter(120, 60000);
  const connectLimit = new RateLimiter(40, 60000);
  const joinLimit = new RateLimiter(config.joinRateLimit, 60000);
  const signalLimit = new RateLimiter(300, 60000);
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  const originAllowed = (origin: string | undefined, host: string | undefined) => {
    if (!origin) return false;
    try {
      const url = new URL(origin);
      return config.publicUrl ? url.origin === config.publicUrl : ['http:', 'https:'].includes(url.protocol) && url.host === host;
    } catch { return false; }
  };
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (process.env.NODE_ENV === 'production') res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' ws: wss:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    next();
  });
  // Opening localhost with PUBLIC_URL configured must not create an unusable
  // local session or fail the canonical-origin checks on POST /api/rooms.
  app.use((req, res, next) => {
    if (config.publicUrl && req.method === 'GET' && (req.path === '/' || /^\/join\/[\w-]+$/.test(req.path))
      && (req.headers.host !== new URL(config.publicUrl).host || !req.secure)) {
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, `${config.publicUrl}${req.path}`);
    }
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/config', (req, res) => {
    if (!configLimit.allow(req.ip || 'unknown')) return res.status(429).json({ error: '요청이 너무 많습니다. 1분 후 다시 시도하세요.' });
    return res.json({ publicUrl: config.publicUrl, maxFileSize: config.maxFileSize, maxSessionBytes: config.maxSessionBytes, iceServers: clientIceServers(config) });
  });
  app.post('/api/rooms', (req, res) => {
    if (!originAllowed(req.headers.origin, req.headers.host)) return res.status(403).json({ error: '허용되지 않은 요청입니다.' });
    if (!createLimit.allow(req.ip || 'unknown')) return res.status(429).json({ error: '요청이 너무 많습니다. 1분 후 다시 시도하세요.' });
    try { res.status(201).json(rooms.create()); }
    catch { res.status(503).json({ error: '서버가 혼잡합니다. 잠시 후 다시 시도하세요.' }); }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  const send = (ws: WebSocket, message: ServerSignal) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 256000) { ws.terminate(); return; }
    ws.send(JSON.stringify(message));
  };
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') return; // Vite handles its own HMR upgrade in development.
    // Express derives req.ip using exactly the configured trusted proxy hop count.
    Object.setPrototypeOf(req, app.request);
    const ip = (req as express.Request).ip || req.socket.remoteAddress || 'unknown';
    if (!originAllowed(req.headers.origin, req.headers.host) || !connectLimit.allow(ip) || peers.size >= 20000) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, ip));
  });
  wss.on('connection', (ws: WebSocket, ip: string) => {
    const peerId = randomUUID();
    const peer = { ws, roomId: undefined as string | undefined, alive: true };
    peers.set(peerId, peer);
    const joinTimer = setTimeout(() => { if (!peer.roomId) ws.close(1008, 'Join timeout'); }, 10000);
    ws.on('pong', () => { peer.alive = true; });
    ws.on('error', () => ws.terminate());
    ws.on('message', (raw, binary) => {
      try {
        if (binary || !signalLimit.allow(peerId)) throw new Error('허용되지 않거나 너무 많은 연결 요청입니다.');
        const result = signalSchema.safeParse(JSON.parse(raw.toString()));
        if (!result.success) throw new Error('잘못된 연결 요청입니다.');
        const message = result.data;
        if (message.type === 'JOIN') {
          if (peer.roomId) throw new Error('이미 세션에 참가했습니다.');
          if (!joinLimit.allow(ip)) throw new Error('연결 시도가 너무 많습니다. 1분 후 다시 시도하세요.');
          const room = rooms.join(peerId, message);
          peer.roomId = room.roomId;
          clearTimeout(joinTimer);
          send(ws, { type: 'JOINED', peerId, roomId: room.roomId, code: room.code, expiresAt: room.expiresAt });
          if (room.peers.size === 2) {
            const ids = [...room.peers];
            for (const id of ids) send(peers.get(id)!.ws, { type: 'PEER_JOINED', initiator: id === ids[0] });
          }
        } else {
          const room = rooms.rooms.get(peer.roomId || '');
          if (!room || room.peers.size !== 2) throw new Error('상대 기기가 연결되어 있지 않습니다.');
          for (const id of room.peers) if (id !== peerId) send(peers.get(id)!.ws, message);
        }
      } catch (error) {
        send(ws, { type: 'ERROR', message: error instanceof Error ? error.message : '연결 요청을 처리할 수 없습니다.' });
        ws.close(1008, 'Invalid request');
      }
    });
    ws.on('close', () => {
      clearTimeout(joinTimer);
      peers.delete(peerId);
      if (!peer.roomId) return;
      rooms.leave(peer.roomId, peerId);
      const room = rooms.rooms.get(peer.roomId);
      if (room) for (const id of room.peers) send(peers.get(id)!.ws, { type: 'PEER_LEFT' });
    });
  });
  const sweepTimer = setInterval(() => {
    for (const id of rooms.sweep()) {
      const peer = peers.get(id);
      if (peer) { send(peer.ws, { type: 'ROOM_EXPIRED' }); peer.ws.close(1000, 'Room expired'); }
    }
    for (const limit of [createLimit, configLimit, connectLimit, joinLimit, signalLimit]) limit.sweep();
  }, Math.min(config.roomTtl, 5000));
  const heartbeat = setInterval(() => {
    for (const peer of peers.values()) {
      if (!peer.alive) { peer.ws.terminate(); continue; }
      peer.alive = false;
      peer.ws.ping();
    }
  }, 15000);
  sweepTimer.unref(); heartbeat.unref();
  return {
    app, server, rooms,
    close: async () => {
      clearInterval(sweepTimer); clearInterval(heartbeat);
      for (const peer of peers.values()) peer.ws.terminate();
      wss.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
