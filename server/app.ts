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
  type Peer = { ws: WebSocket; roomId?: string; alive: boolean; deviceId?: string; resumeToken?: string; graceTimer?: ReturnType<typeof setTimeout> };
  const peers = new Map<string, Peer>();
  const resumes = new Map<string, string>();
  const negotiations = new Map<string, { id: string; restartedAt: number }>();
  const resumeGrace = 120000;
  let shuttingDown = false;
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
    // Only the public home page belongs in search results. A crawler must be
    // able to read this header on temporary invitation URLs to honor noindex.
    if (/^\/(?:join|api|ws)(?:\/|$)/i.test(req.path)) res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
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
  const leave = (peerId: string) => {
    const peer = peers.get(peerId);
    if (!peer) return;
    clearTimeout(peer.graceTimer);
    peers.delete(peerId);
    if (peer.resumeToken) resumes.delete(peer.resumeToken);
    if (!peer.roomId) return;
    rooms.leave(peer.roomId, peerId);
    negotiations.delete(peer.roomId);
    const room = rooms.rooms.get(peer.roomId);
    if (room) for (const id of room.peers) { const other = peers.get(id); if (other) send(other.ws, { type: 'PEER_LEFT' }); }
  };
  const notifyPair = (roomId: string, type: 'PEER_JOINED' | 'PEER_RESUMED') => {
    const room = rooms.rooms.get(roomId);
    if (!room || room.peers.size !== 2) return;
    const ids = [...room.peers];
    if (ids.some(id => peers.get(id)?.ws.readyState !== WebSocket.OPEN)) return;
    if (type === 'PEER_JOINED' || !negotiations.has(roomId)) negotiations.set(roomId, { id: randomUUID(), restartedAt: Date.now() });
    for (const id of ids) send(peers.get(id)!.ws, { type, initiator: id === ids[0], peerDeviceId: peers.get(ids.find(other => other !== id)!)?.deviceId, negotiationId: negotiations.get(roomId)!.id });
  };
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') {
      // Development Vite owns its HMR upgrade. Production must not leave an
      // unhandled upgraded socket alive outside both HTTP and WS tracking.
      if (process.env.NODE_ENV === 'production') socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n', () => socket.destroy());
      return;
    }
    // Express derives req.ip using exactly the configured trusted proxy hop count.
    Object.setPrototypeOf(req, app.request);
    const ip = (req as express.Request).ip || req.socket.remoteAddress || 'unknown';
    if (!originAllowed(req.headers.origin, req.headers.host) || !connectLimit.allow(ip) || peers.size >= 20000) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n', () => socket.destroy()); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, ip));
  });
  wss.on('connection', (ws: WebSocket, ip: string) => {
    let peerId: string = randomUUID();
    let peer: Peer = { ws, alive: true };
    peers.set(peerId, peer);
    const joinTimer = setTimeout(() => { if (!peer.roomId) ws.close(1008, 'Join timeout'); }, 10000);
    ws.on('pong', () => { if (peer.ws === ws) peer.alive = true; });
    ws.on('error', () => ws.terminate());
    ws.on('message', (raw, binary) => {
      if (peer.ws !== ws || peers.get(peerId) !== peer) return;
      try {
        if (binary || !signalLimit.allow(peerId)) throw new Error('허용되지 않거나 너무 많은 연결 요청입니다.');
        const result = signalSchema.safeParse(JSON.parse(raw.toString()));
        if (!result.success) throw new Error('잘못된 연결 요청입니다.');
        const message = result.data;
        if (message.type === 'JOIN') {
          if (peer.roomId) throw new Error('이미 세션에 참가했습니다.');
          let resumed = false;
          if (message.resumeToken) {
            const previousId = resumes.get(message.resumeToken);
            const previous = previousId ? peers.get(previousId) : undefined;
            if (!previous || previous.roomId !== message.roomId || previous.deviceId !== message.deviceId || !rooms.rooms.get(previous.roomId!)?.peers.has(previousId!)) throw new Error('자동 복구 시간이 지났습니다. 새 연결을 시작하세요.');
            peers.delete(peerId);
            peerId = previousId!;
            peer = previous;
            clearTimeout(peer.graceTimer); peer.graceTimer = undefined;
            const oldSocket = peer.ws; peer.ws = ws; peer.alive = true;
            if (oldSocket !== ws) oldSocket.close(1000, 'Resumed elsewhere');
            resumed = true;
          } else {
            if (!joinLimit.allow(ip)) throw new Error('연결 시도가 너무 많습니다. 1분 후 다시 시도하세요.');
            const joined = rooms.join(peerId, message);
            peer.roomId = joined.roomId; peer.deviceId = message.deviceId;
            if (message.deviceId) { peer.resumeToken = randomUUID(); resumes.set(peer.resumeToken, peerId); }
          }
          const room = rooms.rooms.get(peer.roomId!)!;
          clearTimeout(joinTimer);
          send(ws, { type: 'JOINED', peerId, roomId: room.roomId, code: room.code, expiresAt: room.expiresAt, resumeToken: peer.resumeToken, resumed });
          notifyPair(room.roomId, resumed ? 'PEER_RESUMED' : 'PEER_JOINED');
        } else if (message.type === 'LEAVE') {
          leave(peerId); ws.close(1000, 'Left');
        } else {
          const room = rooms.rooms.get(peer.roomId || '');
          if (!room || room.peers.size !== 2) throw new Error('상대 기기가 연결되어 있지 않습니다.');
          if (message.type === 'RECONNECT') {
            // Both ends may notice a failed channel at once. Assign one offerer
            // and one fresh epoch, rather than permitting simultaneous offers.
            if (Date.now() - (negotiations.get(room.roomId)?.restartedAt || 0) >= 1000) notifyPair(room.roomId, 'PEER_JOINED');
          } else {
            if (message.negotiationId && message.negotiationId !== negotiations.get(room.roomId)?.id) return;
            for (const id of room.peers) if (id !== peerId) { const other = peers.get(id); if (other) send(other.ws, message); }
          }
        }
      } catch (error) {
        send(ws, { type: 'ERROR', message: error instanceof Error ? error.message : '연결 요청을 처리할 수 없습니다.' });
        ws.close(1008, 'Invalid request');
      }
    });
    ws.on('close', () => {
      clearTimeout(joinTimer);
      if (peer.ws !== ws || peers.get(peerId) !== peer) return;
      if (shuttingDown || !peer.roomId || !peer.resumeToken) { leave(peerId); return; }
      // A signaling interruption must not tear down a healthy direct channel.
      // Reserve the slot for its secret token while the browser reconnects.
      peer.graceTimer = setTimeout(() => leave(peerId), resumeGrace);
      peer.graceTimer.unref();
    });
  });
  const sweepTimer = setInterval(() => {
    for (const id of rooms.sweep()) {
      const peer = peers.get(id);
      if (peer) { send(peer.ws, { type: 'ROOM_EXPIRED' }); peer.ws.close(1000, 'Room expired'); leave(id); }
    }
    for (const limit of [createLimit, configLimit, connectLimit, joinLimit, signalLimit]) limit.sweep();
  }, Math.min(config.roomTtl, 5000));
  const heartbeat = setInterval(() => {
    for (const peer of peers.values()) {
      if (peer.ws.readyState !== WebSocket.OPEN) continue;
      if (!peer.alive) { peer.ws.terminate(); continue; }
      peer.alive = false;
      peer.ws.ping();
    }
  }, 15000);
  sweepTimer.unref(); heartbeat.unref();
  let closing: Promise<void> | undefined;
  return {
    app, server, rooms,
    close: () => {
      if (closing) return closing;
      clearInterval(sweepTimer); clearInterval(heartbeat);
      shuttingDown = true;
      for (const peer of peers.values()) { clearTimeout(peer.graceTimer); peer.ws.terminate(); }
      wss.close();
      closing = new Promise<void>(resolve => {
        const deadline = setTimeout(() => server.closeAllConnections(), 5000);
        deadline.unref();
        server.close(() => { clearTimeout(deadline); resolve(); });
      });
      return closing;
    },
  };
}
